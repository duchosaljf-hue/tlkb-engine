import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyD4G2DU-XJhSU1LQ7JWawSLulagPeFi-cc',
  authDomain: 'tlkb-engine-prod.firebaseapp.com',
  projectId: 'tlkb-engine-prod',
  storageBucket: 'tlkb-engine-prod.firebasestorage.app',
  messagingSenderId: '448945628707',
  appId: '1:448945628707:web:c5829517c1dea21033b396',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function levenshtein(a, b) {
  const na = a.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const nb = b.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const m = Array.from({ length: nb.length + 1 }, (_, j) => [j, ...Array(na.length).fill(0)]);
  for (let i = 0; i <= na.length; i++) m[0][i] = i;
  for (let j = 1; j <= nb.length; j++) {
    for (let i = 1; i <= na.length; i++) {
      const cost = na[i - 1] === nb[j - 1] ? 0 : 1;
      m[j][i] = Math.min(m[j][i - 1] + 1, m[j - 1][i] + 1, m[j - 1][i - 1] + cost);
    }
  }
  return m[nb.length][na.length];
}

function parseCsvLine(line) {
  const out = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) { out.push(cell); cell = ''; }
    else cell += c;
  }
  out.push(cell);
  return out;
}

const COLUMNS = [
  'id', 'type', 'nom', 'definition', 'exemple', 'auteur', 'domaine', 'sous_domaine',
  'difficulte', 'utilite', 'famille', 'contraire', 'origine', 'tags', 'liens', 'alias',
  'prerequis', 'pieges', 'applications',
];

function parseCsv(text) {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    if (cols.length < 19) return null;
    const card = {};
    COLUMNS.forEach((key, idx) => { card[key] = (cols[idx] || '').trim(); });
    return card;
  }).filter(Boolean);
}

// ---- Spaced repetition engine (stability-based, R(t)=e^(-t/S), inspired by FSRS principles) ----
const LEARNING_STEPS_MIN = [10, 1440]; // 10 minutes, then 1 day, before the first real review
const TARGET_RETENTION = 0.9; // aim to review a fiche just before recall probability drops below this
const K = -Math.log(TARGET_RETENTION); // R(t)=target  =>  t = S * K
const INITIAL_STABILITY = 2 / K; // gives a ~2-day first interval after graduation
const MIN_STABILITY = 1 / K; // floor, ~1-day minimum interval
const MATURE_DAYS = 21; // a fiche is considered "mature" once its interval reaches this

function scheduleFromStability(stability) {
  return Math.max(1, Math.round(stability * K));
}

function computeGrowthFactor(grade, difficultyMemory) {
  if (grade === 'hard') return 1.2;
  if (grade === 'good') return 1.5 + (10 - difficultyMemory) / 10;
  if (grade === 'easy') return 2.0 + ((10 - difficultyMemory) / 10) * 1.5;
  return 1;
}

function dateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
const s = {
  page: { minHeight: '100vh', background: '#f8fafc', color: '#0f172a', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', padding: '20px', paddingBottom: '80px', boxSizing: 'border-box' },
  card: { background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: 24, maxWidth: 720, margin: '0 auto 20px auto' },
  input: { width: '100%', padding: '12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 15, boxSizing: 'border-box', outline: 'none' },
  btnPrimary: { background: '#4f46e5', color: '#fff', border: 'none', padding: '12px 20px', borderRadius: 10, fontWeight: 600, fontSize: 15, cursor: 'pointer' },
  btnSecondary: { background: '#eef2ff', color: '#4338ca', border: 'none', padding: '12px 20px', borderRadius: 10, fontWeight: 600, fontSize: 15, cursor: 'pointer' },
  btnGhost: { background: '#f1f5f9', color: '#334155', border: 'none', padding: '10px 16px', borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: 'pointer' },
  h1: { fontSize: 22, fontWeight: 800, margin: 0 },
  label: { fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 6, display: 'block' },
};

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);

  const [cards, setCards] = useState([]);
  const [rawCsv, setRawCsv] = useState('');
  const [importMsg, setImportMsg] = useState('');

  const [currentCard, setCurrentCard] = useState(null);
  const [mode, setMode] = useState(null);
  const [qcmOptions, setQcmOptions] = useState([]);
  const [userInput, setUserInput] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [cycle, setCycle] = useState(0);
  const [dailyNewLimit, setDailyNewLimit] = useState(() => {
    const saved = localStorage.getItem('tlkb_daily_new_limit');
    return saved ? parseInt(saved, 10) : 10;
  });
  const [noMoreToday, setNoMoreToday] = useState(false);
  const [dailyLesson, setDailyLesson] = useState(null);
  const [lessonIndex, setLessonIndex] = useState(0);
  const [lessonScratch, setLessonScratch] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [cardShownAt, setCardShownAt] = useState(null);

  const updateDailyLimit = (val) => {
    const n = Math.max(1, parseInt(val, 10) || 10);
    setDailyNewLimit(n);
    localStorage.setItem('tlkb_daily_new_limit', String(n));
  };

  const isToday = (ts) => {
    if (!ts) return false;
    const d = new Date(ts);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) { setCards([]); return; }
    const ref = collection(db, 'users', user.uid, 'cards');
    const unsub = onSnapshot(ref, (snap) => {
      setCards(snap.docs.map((d) => d.data()));
    });
    return unsub;
  }, [user]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isSignUp) await createUserWithEmailAndPassword(auth, email, password);
      else await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleGoogle = async () => {
    setAuthError('');
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (err) { setAuthError(err.message); }
  };

  const importText = async (text) => {
    if (!text.trim() || !user) return;
    const parsed = parseCsv(text);
    if (parsed.length === 0) { setImportMsg("Aucune fiche valide détectée. Vérifiez l'en-tête et les colonnes."); return; }
    const ref = collection(db, 'users', user.uid, 'cards');
    let count = 0;
    for (const card of parsed) {
      const existing = cards.find((c) => c.id === card.id);
      await setDoc(doc(ref, card.id), {
        ...card,
        level: existing ? existing.level : 0,
        confidence: existing ? existing.confidence : 0,
        nextReview: existing ? existing.nextReview : 0,
      }, { merge: true });
      count++;
    }
    setImportMsg(`${count} fiche(s) importée(s) avec succès.`);
    setRawCsv('');
  };

  const handleImport = () => importText(rawCsv);

  const handleDeleteAll = async () => {
    if (!user || cards.length === 0) return;
    const sure = window.confirm(`Supprimer définitivement les ${cards.length} fiches actuelles ? Cette action est irréversible.`);
    if (!sure) return;
    const confirmAgain = window.confirm('Confirmez une seconde fois : toutes les fiches et leur progression seront perdues.');
    if (!confirmAgain) return;
    setImportMsg('Suppression en cours…');
    const ref = collection(db, 'users', user.uid, 'cards');
    for (const card of cards) {
      await deleteDoc(doc(ref, card.id));
    }
    setImportMsg('Toutes les fiches ont été supprimées. Vous pouvez importer un nouveau fichier.');
  };

  const handleFileImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => importText(ev.target.result);
    reader.readAsText(file);
    e.target.value = '';
  };

  const CULTURE_TYPES = ['personnalite', 'oeuvre', 'evenement', 'citation', 'figure_rhetorique', 'experience_pensee'];

  const startDailyLesson = () => {
    const now = Date.now();
    const due = cards.filter((c) => c.firstSeenAt && (c.nextReview || 0) <= now)
      .sort((a, b) => {
        const fa = (a.stability || INITIAL_STABILITY) - (a.failureCount || 0) * 2;
        const fb = (b.stability || INITIAL_STABILITY) - (b.failureCount || 0) * 2;
        return fa - fb;
      })
      .slice(0, 5);

    const pickByType = (type, exclude) => {
      const pool = cards.filter((c) => c.type === type && !exclude.includes(c.id));
      const dueOne = pool.find((c) => c.firstSeenAt && (c.nextReview || 0) <= now);
      if (dueOne) return dueOne;
      const newOne = pool.filter((c) => !c.firstSeenAt).sort((a, b) => (parseInt(b.utilite) || 3) - (parseInt(a.utilite) || 3))[0];
      return newOne || pool[0] || null;
    };

    const used = due.map((c) => c.id);
    const mot = pickByType('mot', used);
    if (mot) used.push(mot.id);
    const concept = pickByType('concept', used);
    if (concept) used.push(concept.id);
    let culture = null;
    for (const t of CULTURE_TYPES) {
      culture = pickByType(t, used);
      if (culture) break;
    }
    if (culture) used.push(culture.id);

    const steps = [];
    due.forEach((c) => steps.push({ type: 'revision', card: c }));
    if (mot) steps.push({ type: 'mot', card: mot });
    if (concept) steps.push({ type: 'concept', card: concept });
    if (culture) steps.push({ type: 'culture', card: culture });
    if (mot) steps.push({ type: 'lexical', card: mot });
    const recallCards = [mot, concept, culture].filter(Boolean);
    if (recallCards.length) steps.push({ type: 'recall', cards: recallCards });
    const appCard = concept || mot || culture;
    if (appCard) steps.push({ type: 'application', card: appCard });

    if (steps.length === 0) { setImportMsg("Pas assez de fiches variées (mot/concept/référence) pour composer une leçon."); return; }
    setDailyLesson(steps);
    setLessonIndex(0);
    setLessonScratch('');
    setRevealed(false);
  };

  const acknowledgeAndInit = async (card) => {
    const now = Date.now();
    if (!card.firstSeenAt) {
      await saveCard({
        ...card,
        firstSeenAt: now,
        learningStep: 0,
        nextReview: now + LEARNING_STEPS_MIN[0] * 60000,
        difficultyMemory: card.difficultyMemory || 5,
        totalReviews: card.totalReviews || 0,
      });
    } else if ((card.nextReview || 0) <= now) {
      const difficultyMemory = card.difficultyMemory || 5;
      const factor = computeGrowthFactor('good', difficultyMemory);
      const stability = (card.stability || INITIAL_STABILITY) * factor;
      const interval = scheduleFromStability(stability);
      await saveCard({
        ...card,
        stability,
        interval,
        nextReview: now + interval * 86400000,
        successCount: (card.successCount || 0) + 1,
        totalReviews: (card.totalReviews || 0) + 1,
        lastReviewAt: now,
        lastReview: now,
      });
    }
  };

  const advanceLesson = () => {
    setLessonScratch('');
    setRevealed(false);
    if (lessonIndex + 1 < dailyLesson.length) setLessonIndex(lessonIndex + 1);
    else { setDailyLesson(null); setLessonIndex(0); }
  };

  const getNextCard = useCallback(() => {
    const now = Date.now();
    const newToday = cards.filter((c) => isToday(c.firstSeenAt)).length;
    const capReached = newToday >= dailyNewLimit;

    const brandNew = cards.filter((c) => !c.firstSeenAt);
    const learningDue = cards.filter((c) => c.firstSeenAt && typeof c.learningStep === 'number' && c.learningStep < LEARNING_STEPS_MIN.length && (c.nextReview || 0) <= now);
    const reviewDue = cards.filter((c) => c.firstSeenAt && (c.learningStep === undefined || c.learningStep === null) && (c.nextReview || 0) <= now);

    const eligibleNew = capReached ? [] : brandNew.filter((c) => {
      if (!c.prerequis) return true;
      return c.prerequis.split(';').filter(Boolean).every((id) => {
        const req = cards.find((x) => x.id === id);
        return req && req.firstSeenAt;
      });
    }).sort((a, b) => {
      const pa = (parseInt(a.utilite) || 3) * 2 + (6 - (parseInt(a.difficulte) || 3));
      const pb = (parseInt(b.utilite) || 3) * 2 + (6 - (parseInt(b.difficulte) || 3));
      return pb - pa;
    });

    reviewDue.sort((a, b) => {
      const fa = (a.stability || INITIAL_STABILITY) - (b.failureCount || 0) * 2;
      const fb = (b.stability || INITIAL_STABILITY) - (a.failureCount || 0) * 2;
      return fa - fb;
    });

    let next = null;
    if (learningDue.length) {
      next = learningDue[0];
    } else {
      const wantNew = cycle >= 4;
      if (wantNew && eligibleNew.length) { next = eligibleNew[0]; setCycle(0); }
      else if (reviewDue.length) { next = reviewDue[0]; setCycle((c) => c + 1); }
      else if (eligibleNew.length) { next = eligibleNew[0]; setCycle(0); }
    }

    if (!next) {
      setCurrentCard(null);
      setMode(null);
      setNoMoreToday(capReached && brandNew.length > 0);
      return;
    }
    setNoMoreToday(false);
    setCurrentCard(next);
    setCardShownAt(Date.now());
    setMode(!next.firstSeenAt ? 'lesson' : null);
    setFeedback(null);
    setUserInput('');
  }, [cards, cycle, dailyNewLimit]);

  const saveCard = async (updated) => {
    const ref = collection(db, 'users', user.uid, 'cards');
    await setDoc(doc(ref, updated.id), updated, { merge: true });
    setCurrentCard(updated);
  };

  const acknowledgeLesson = async () => {
    const updated = {
      ...currentCard,
      firstSeenAt: Date.now(),
      learningStep: 0,
      nextReview: Date.now() + LEARNING_STEPS_MIN[0] * 60000,
      difficultyMemory: currentCard.difficultyMemory || 5,
      totalReviews: currentCard.totalReviews || 0,
    };
    await saveCard(updated);
    const stepLabel = LEARNING_STEPS_MIN[0] >= 60 ? `${Math.round(LEARNING_STEPS_MIN[0] / 60)} h` : `${LEARNING_STEPS_MIN[0]} min`;
    setFeedback({ success: true, isLesson: true, message: `Première révision programmée dans ${stepLabel}.` });
    setMode('feedback');
  };

  const generateQcm = () => {
    let pool = cards.filter((c) => c.id !== currentCard.id && c.famille === currentCard.famille);
    if (pool.length < 3) pool = [...pool, ...cards.filter((c) => c.id !== currentCard.id && c.difficulte === currentCard.difficulte)];
    const distractors = Array.from(new Set(pool.map((c) => c.nom))).sort(() => 0.5 - Math.random()).slice(0, 3);
    while (distractors.length < 3) distractors.push('—');
    setQcmOptions([...distractors, currentCard.nom].sort(() => 0.5 - Math.random()));
    setMode('qcm');
  };

  const processResult = async (grade) => {
    const now = Date.now();
    const c = currentCard;
    const responseTimeMs = cardShownAt ? now - cardShownAt : c.responseTimeMs || null;
    const inLearning = typeof c.learningStep === 'number' && c.learningStep < LEARNING_STEPS_MIN.length;
    const difficultyMemory = c.difficultyMemory || 5;
    let updated;

    if (grade === 'again') {
      const failureCount = (c.failureCount || 0) + 1;
      if (inLearning) {
        updated = { ...c, learningStep: 0, nextReview: now + LEARNING_STEPS_MIN[0] * 60000, failureCount };
      } else {
        const stability = Math.max(MIN_STABILITY, (c.stability || INITIAL_STABILITY) * 0.5);
        updated = {
          ...c,
          stability,
          difficultyMemory: Math.min(10, difficultyMemory + 1),
          failureCount,
          lapseCount: (c.lapseCount || 0) + 1,
          learningStep: 0,
          relearning: true,
          nextReview: now + LEARNING_STEPS_MIN[0] * 60000,
        };
      }
    } else if (inLearning) {
      const nextStep = c.learningStep + 1;
      if (nextStep < LEARNING_STEPS_MIN.length) {
        updated = { ...c, learningStep: nextStep, nextReview: now + LEARNING_STEPS_MIN[nextStep] * 60000 };
      } else {
        let stability;
        if (c.relearning) {
          stability = Math.max(MIN_STABILITY, (c.stability || INITIAL_STABILITY) * 1.2);
        } else {
          stability = INITIAL_STABILITY * (grade === 'easy' ? 1.3 : 1);
        }
        const interval = scheduleFromStability(stability);
        updated = {
          ...c,
          learningStep: null,
          relearning: false,
          stability,
          interval,
          nextReview: now + interval * 86400000,
          successCount: (c.successCount || 0) + 1,
        };
      }
    } else {
      const factor = computeGrowthFactor(grade, difficultyMemory);
      const stability = (c.stability || INITIAL_STABILITY) * factor;
      const interval = scheduleFromStability(stability);
      const diffDelta = { hard: 0.5, good: -0.2, easy: -0.5 }[grade] || 0;
      updated = {
        ...c,
        stability,
        interval,
        nextReview: now + interval * 86400000,
        difficultyMemory: Math.max(1, Math.min(10, difficultyMemory + diffDelta)),
        successCount: (c.successCount || 0) + 1,
      };
    }

    updated.totalReviews = (c.totalReviews || 0) + 1;
    updated.lastReviewAt = now;
    updated.lastReview = now;
    updated.responseTimeMs = responseTimeMs;
    updated.attempt = c.relearning ? 2 : 1;
    await saveCard(updated);
    setMode('feedback');
  };

  const handleQcmSelect = (opt) => {
    const success = opt === currentCard.nom;
    if (!success) {
      setFeedback({ success: false, message: `Réponse attendue : ${currentCard.nom}` });
      processResult('again');
    } else {
      setMode('grade');
    }
  };

  const handleInputSubmit = () => {
    const target = currentCard.nom;
    const limit = target.length <= 4 ? 0 : target.length <= 8 ? 1 : 2;
    let match = levenshtein(target, userInput) <= limit;
    if (!match && currentCard.alias) {
      match = currentCard.alias.split(';').some((a) => levenshtein(a, userInput) <= limit);
    }
    if (!match) {
      setFeedback({ success: false, message: `Notion attendue : ${target}` });
      processResult('again');
    } else {
      setMode('grade');
    }
  };

  const handleGradeSelect = (grade) => {
    const labels = { hard: 'Difficile — révisée bientôt.', good: 'Correct — intervalle allongé normalement.', easy: 'Facile — intervalle allongé fortement.' };
    setFeedback({ success: true, message: labels[grade] });
    processResult(grade);
  };

  if (authLoading) return <div style={{ ...s.page, textAlign: 'center', paddingTop: 100 }}>Chargement…</div>;

  if (!user) {
    return (
      <div style={s.page}>
        <div style={{ ...s.card, maxWidth: 400, marginTop: 60 }}>
          <h2 style={{ textAlign: 'center', marginBottom: 20 }}>TLKB Engine</h2>
          <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={s.label}>E-mail</label>
              <input style={s.input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label style={s.label}>Mot de passe</label>
              <input style={s.input} type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {authError && <div style={{ color: '#dc2626', fontSize: 13 }}>{authError}</div>}
            <button type="submit" style={s.btnPrimary}>{isSignUp ? "S'inscrire" : 'Se connecter'}</button>
          </form>
          <button style={{ ...s.btnGhost, width: '100%', marginTop: 12 }} onClick={handleGoogle}>Continuer avec Google</button>
          <button style={{ background: 'none', border: 'none', color: '#4f46e5', marginTop: 12, cursor: 'pointer', width: '100%' }} onClick={() => setIsSignUp(!isSignUp)}>
            {isSignUp ? 'Déjà un compte ? Se connecter' : 'Créer un compte'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={{ ...s.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={s.h1}>TLKB Engine</h1>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>{cards.length} fiche(s) en base</p>
        </div>
        <button style={s.btnGhost} onClick={() => signOut(auth)}>Déconnexion</button>
      </div>

      {!currentCard && !dailyLesson && (
        <>
          {cards.length > 0 && (() => {
            const total = cards.length;
            const started = cards.filter((c) => c.firstSeenAt).length;
            const pct = Math.round((started / total) * 100);
            const now = Date.now();
            const due = cards.filter((c) => c.firstSeenAt && (c.nextReview || 0) <= now).length;
            const newOnes = total - started;
            const mastered = cards.filter((c) => (c.interval || 0) >= MATURE_DAYS).length;
            const totalReviewsAll = cards.reduce((sum, c) => sum + (c.totalReviews || 0), 0);
            const reviewsToday = cards.filter((c) => isToday(c.lastReviewAt)).length;
            const newToday = cards.filter((c) => isToday(c.firstSeenAt)).length;

            const activeDays = new Set(cards.filter((c) => c.lastReviewAt).map((c) => dateKey(c.lastReviewAt)));
            let streak = 0;
            let cursor = new Date();
            if (!activeDays.has(dateKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
            while (activeDays.has(dateKey(cursor.getTime()))) {
              streak++;
              cursor.setDate(cursor.getDate() - 1);
            }

            const nextMilestone = Math.ceil((mastered + 1) / 10) * 10;
            const toMilestone = nextMilestone - mastered;

            return (
              <div style={s.card}>
                <h3 style={{ marginTop: 0 }}>Progression</h3>
                <div style={{ background: '#e2e8f0', borderRadius: 999, height: 10, overflow: 'hidden', marginBottom: 6 }}>
                  <div style={{ width: `${pct}%`, background: '#4f46e5', height: '100%' }} />
                </div>
                <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 16px' }}>{started} / {total} fiches abordées ({pct}%)</p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, textAlign: 'center' }}>
                  <div style={{ background: due > 0 ? '#fff7ed' : '#f0fdf4', borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: due > 0 ? '#c2410c' : '#16a34a' }}>{due}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>à réviser</div>
                  </div>
                  <div style={{ background: '#eef2ff', borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#4338ca' }}>{newOnes}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>nouvelles</div>
                  </div>
                  <div style={{ background: '#fef9c3', borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#a16207' }}>{streak} 🔥</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>jours de suite</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, textAlign: 'center', marginTop: 10 }}>
                  <div style={{ background: '#f0fdfa', borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#0f766e' }}>{mastered}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>maîtrisées (≥{MATURE_DAYS}j)</div>
                  </div>
                  <div style={{ background: '#f1f5f9', borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#334155' }}>{totalReviewsAll}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>révisions au total</div>
                  </div>
                  <div style={{ background: '#f5f3ff', borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#6d28d9' }}>{reviewsToday}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>fiches vues aujourd'hui</div>
                  </div>
                </div>

                {mastered > 0 && (
                  <p style={{ fontSize: 13, color: '#0f766e', background: '#f0fdfa', borderRadius: 8, padding: '8px 12px', marginTop: 12 }}>
                    Plus que {toMilestone} fiche{toMilestone > 1 ? 's' : ''} maîtrisée{toMilestone > 1 ? 's' : ''} pour atteindre {nextMilestone} !
                  </p>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
                  <label style={{ fontSize: 13, color: '#475569', flex: 1 }}>
                    Nouvelles leçons max. par jour
                    <span style={{ color: '#94a3b8' }}> ({newToday}/{dailyNewLimit} aujourd'hui)</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={dailyNewLimit}
                    onChange={(e) => updateDailyLimit(e.target.value)}
                    style={{ width: 64, padding: '6px 8px', borderRadius: 8, border: '1px solid #cbd5e1', textAlign: 'center' }}
                  />
                </div>
              </div>
            );
          })()}

          {noMoreToday && (
            <div style={{ ...s.card, background: '#f0fdf4', textAlign: 'center' }}>
              <h3 style={{ marginTop: 0, color: '#16a34a' }}>Quota de nouvelles leçons atteint pour aujourd'hui</h3>
              <p style={{ color: '#475569', fontSize: 14 }}>
                Revenez demain pour de nouvelles découvertes, ou augmentez la limite ci-dessus.
              </p>
            </div>
          )}

          {cards.length > 0 && (
            <div style={{ ...s.card, borderColor: '#fecaca' }}>
              <h3 style={{ marginTop: 0, color: '#b91c1c' }}>Zone sensible</h3>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 12px' }}>
                Supprime définitivement les {cards.length} fiches actuelles et leur progression, pour repartir d'une base propre.
              </p>
              <button
                style={{ background: '#fee2e2', color: '#b91c1c', border: 'none', padding: '10px 16px', borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
                onClick={handleDeleteAll}
              >
                Supprimer toutes les fiches
              </button>
            </div>
          )}

          <div style={s.card}>
            <h3 style={{ marginTop: 0 }}>Import CSV (schéma 19 colonnes)</h3>
            <textarea
              style={{ ...s.input, height: 140, fontFamily: 'monospace', fontSize: 12 }}
              placeholder="Collez ici le CSV avec sa ligne d'en-tête..."
              value={rawCsv}
              onChange={(e) => setRawCsv(e.target.value)}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <label style={{ ...s.btnGhost, cursor: 'pointer' }}>
                Importer un fichier .csv
                <input type="file" accept=".csv,text/csv" onChange={handleFileImport} style={{ display: 'none' }} />
              </label>
              <button style={s.btnPrimary} onClick={handleImport}>Importer le texte collé</button>
            </div>
            {importMsg && <div style={{ fontSize: 13, color: '#64748b', marginTop: 10 }}>{importMsg}</div>}
          </div>

          {cards.length > 0 && (
            <div style={{ ...s.card, textAlign: 'center' }}>
              <h3 style={{ marginTop: 0 }}>Prêt pour l'apprentissage</h3>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button style={s.btnPrimary} onClick={getNextCard}>Session de révision</button>
                <button style={s.btnSecondary} onClick={startDailyLesson}>Leçon du jour composée (7 étapes)</button>
              </div>
            </div>
          )}
        </>
      )}

      {dailyLesson && (() => {
        const step = dailyLesson[lessonIndex];
        const progress = `Étape ${lessonIndex + 1} / ${dailyLesson.length}`;

        const finishStep = async (card) => {
          if (card) await acknowledgeAndInit(card);
          advanceLesson();
        };

        if (step.type === 'revision') {
          const c = step.card;
          return (
            <div style={s.card}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase' }}>{progress} · Révision</span>
              <h2 style={{ margin: '8px 0 4px' }}>{c.nom}</h2>
              {!revealed ? (
                <>
                  <p style={{ color: '#64748b', fontSize: 14 }}>Essayez de vous rappeler la définition avant de révéler.</p>
                  <button style={{ ...s.btnPrimary, marginTop: 8 }} onClick={() => setRevealed(true)}>Révéler</button>
                </>
              ) : (
                <>
                  <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, margin: '12px 0' }}>
                    <p style={{ margin: 0 }}>{c.definition}</p>
                  </div>
                  <button style={{ ...s.btnPrimary, width: '100%' }} onClick={() => finishStep(c)}>Suivant →</button>
                </>
              )}
            </div>
          );
        }

        if (step.type === 'mot' || step.type === 'concept' || step.type === 'culture') {
          const c = step.card;
          const labels = { mot: 'Mot précis', concept: 'Concept', culture: 'Référence culturelle' };
          return (
            <div style={s.card}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase' }}>{progress} · {labels[step.type]}</span>
              <h2 style={{ margin: '8px 0 4px' }}>{c.nom}</h2>
              {c.origine && <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>{c.origine}</p>}
              {c.auteur && <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>{c.auteur}</p>}
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, margin: '12px 0' }}>
                <strong style={{ fontSize: 11, color: '#94a3b8' }}>DÉFINITION</strong>
                <p style={{ fontSize: 17, margin: '6px 0 0' }}>{c.definition}</p>
              </div>
              <div style={{ background: '#eef2ff', borderRadius: 10, padding: 16, margin: '12px 0' }}>
                <strong style={{ fontSize: 11, color: '#6366f1' }}>EXEMPLE</strong>
                <p style={{ margin: '6px 0 0' }}>{c.exemple}</p>
              </div>
              {c.contraire && (
                <div style={{ background: '#fef2f2', borderRadius: 10, padding: 16, margin: '12px 0' }}>
                  <strong style={{ fontSize: 11, color: '#b91c1c' }}>CONTRAIRE</strong>
                  <p style={{ margin: '6px 0 0' }}>{c.contraire}</p>
                </div>
              )}
              {c.pieges && (
                <div style={{ background: '#fff7ed', borderLeft: '4px solid #fb923c', padding: 14, borderRadius: 8, margin: '12px 0' }}>
                  <strong style={{ fontSize: 11, color: '#c2410c' }}>PIÈGE</strong>
                  <p style={{ margin: '6px 0 0' }}>{c.pieges}</p>
                </div>
              )}
              <button style={{ ...s.btnPrimary, width: '100%', marginTop: 8 }} onClick={() => finishStep(c)}>Suivant →</button>
            </div>
          );
        }

        if (step.type === 'lexical') {
          const c = step.card;
          return (
            <div style={s.card}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#0f766e', textTransform: 'uppercase' }}>{progress} · Exercice lexical</span>
              <h2 style={{ margin: '8px 0 16px' }}>{c.nom}</h2>
              <p style={{ fontSize: 15, marginBottom: 12 }}>
                Proposez un synonyme{c.alias ? ' (différent de celui déjà connu)' : ''}
                {c.contraire ? `, puis expliquez en une phrase la différence avec son contraire « ${c.contraire} ».` : '.'}
              </p>
              <textarea
                style={{ ...s.input, height: 80 }}
                placeholder="Votre réponse (non corrigée, pour vous entraîner)..."
                value={lessonScratch}
                onChange={(e) => setLessonScratch(e.target.value)}
              />
              {c.alias && revealed && (
                <p style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>Synonyme(s) connu(s) : {c.alias}</p>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                {c.alias && !revealed && <button style={s.btnGhost} onClick={() => setRevealed(true)}>Voir un synonyme connu</button>}
                <button style={{ ...s.btnPrimary, flex: 1 }} onClick={() => finishStep(null)}>Suivant →</button>
              </div>
            </div>
          );
        }

        if (step.type === 'recall') {
          const qs = [];
          const [c1, c2, c3] = step.cards;
          if (c1) qs.push({ q: `Définissez : ${c1.nom}`, a: c1.definition });
          if (c1 && c2) qs.push({ q: `Quelle différence entre ${c1.nom} et ${c2.nom} ?`, a: `${c1.nom} : ${c1.definition}\n${c2.nom} : ${c2.definition}` });
          const last = c3 || c2 || c1;
          if (last) qs.push({ q: `Comment appliquer « ${last.nom} » à ${last.applications ? last.applications.split(';')[0] : 'une situation professionnelle'} ?`, a: last.exemple });
          return (
            <div style={s.card}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase' }}>{progress} · Rappel actif</span>
              {qs.map((item, i) => (
                <div key={i} style={{ marginTop: i === 0 ? 8 : 20, paddingTop: i === 0 ? 0 : 16, borderTop: i === 0 ? 'none' : '1px solid #e2e8f0' }}>
                  <p style={{ fontWeight: 600, marginBottom: 8 }}>{i + 1}. {item.q}</p>
                  <p style={{ fontSize: 13, color: '#94a3b8' }}>Répondez mentalement ou à voix haute, puis comparez :</p>
                  <p style={{ fontSize: 13, background: '#f8fafc', borderRadius: 8, padding: 10, whiteSpace: 'pre-line' }}>{item.a}</p>
                </div>
              ))}
              <button style={{ ...s.btnPrimary, width: '100%', marginTop: 16 }} onClick={() => finishStep(null)}>Suivant →</button>
            </div>
          );
        }

        if (step.type === 'application') {
          const c = step.card;
          return (
            <div style={s.card}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#a16207', textTransform: 'uppercase' }}>{progress} · Application concrète</span>
              <h2 style={{ margin: '8px 0 16px' }}>{c.nom}</h2>
              {c.applications && (
                <p style={{ fontSize: 14, color: '#64748b', marginBottom: 12 }}>Contextes suggérés : {c.applications.replace(/;/g, ', ')}</p>
              )}
              <p style={{ fontSize: 15, marginBottom: 12 }}>Notez une situation réelle où vous pourriez utiliser cette notion cette semaine.</p>
              <textarea
                style={{ ...s.input, height: 80 }}
                placeholder="Votre application concrète..."
                value={lessonScratch}
                onChange={(e) => setLessonScratch(e.target.value)}
              />
              <button style={{ ...s.btnPrimary, width: '100%', marginTop: 12 }} onClick={() => finishStep(null)}>Terminer la leçon ✓</button>
            </div>
          );
        }

        return null;
      })()}

      {currentCard && mode === 'lesson' && (
        <div style={s.card}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase' }}>Nouvelle découverte</span>
          <h2 style={{ margin: '8px 0 4px' }}>{currentCard.nom}</h2>
          {currentCard.origine && <p style={{ color: '#64748b', fontSize: 13, marginTop: 0 }}>{currentCard.origine}</p>}
          <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, margin: '12px 0' }}>
            <strong style={{ fontSize: 11, color: '#94a3b8' }}>DÉFINITION</strong>
            <p style={{ fontSize: 18, margin: '6px 0 0' }}>{currentCard.definition}</p>
          </div>
          <div style={{ background: '#eef2ff', borderRadius: 10, padding: 16, margin: '12px 0' }}>
            <strong style={{ fontSize: 11, color: '#6366f1' }}>EXEMPLE</strong>
            <p style={{ margin: '6px 0 0' }}>{currentCard.exemple}</p>
          </div>
          {currentCard.pieges && (
            <div style={{ background: '#fff7ed', borderLeft: '4px solid #fb923c', padding: 14, borderRadius: 8, margin: '12px 0' }}>
              <strong style={{ fontSize: 11, color: '#c2410c' }}>PIÈGE</strong>
              <p style={{ margin: '6px 0 0' }}>{currentCard.pieges}</p>
            </div>
          )}
          <button style={{ ...s.btnPrimary, width: '100%', marginTop: 8 }} onClick={acknowledgeLesson}>J'ai compris →</button>
        </div>
      )}

      {currentCard && mode === null && (
        <div style={s.card}>
          <span style={{ fontSize: 11, fontWeight: 700, color: typeof currentCard.learningStep === 'number' ? '#7c3aed' : '#2563eb', textTransform: 'uppercase' }}>
            {typeof currentCard.learningStep === 'number' ? 'Apprentissage en cours' : `Révision — intervalle ${currentCard.interval || 1} j`}
          </span>
          <h2 style={{ fontStyle: 'italic', fontWeight: 500 }}>« {currentCard.definition} »</h2>
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button style={{ ...s.btnSecondary, flex: 1 }} onClick={generateQcm}>QCM</button>
            <button style={{ ...s.btnPrimary, flex: 1 }} onClick={() => setMode('input')}>Saisie libre</button>
          </div>
        </div>
      )}

      {currentCard && mode === 'qcm' && (
        <div style={s.card}>
          <h2 style={{ fontStyle: 'italic', fontWeight: 500 }}>« {currentCard.definition} »</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
            {qcmOptions.map((opt, i) => (
              <button key={i} style={{ ...s.btnGhost, textAlign: 'left', padding: 16 }} onClick={() => handleQcmSelect(opt)}>{opt}</button>
            ))}
          </div>
        </div>
      )}

      {currentCard && mode === 'input' && (
        <div style={s.card}>
          <h2 style={{ fontStyle: 'italic', fontWeight: 500 }}>« {currentCard.definition} »</h2>
          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <input style={s.input} autoFocus value={userInput} onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleInputSubmit()} placeholder="Nom de la notion..." />
            <button style={s.btnPrimary} onClick={handleInputSubmit}>Valider</button>
          </div>
        </div>
      )}

      {currentCard && mode === 'grade' && (
        <div style={s.card}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase' }}>Bonne réponse</span>
          <h2 style={{ margin: '8px 0 16px' }}>{currentCard.nom}</h2>
          <p style={{ fontSize: 14, color: '#64748b', marginBottom: 16 }}>À quel point ce rappel était-il facile ?</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <button style={{ background: '#fee2e2', color: '#b91c1c', border: 'none', padding: '14px 8px', borderRadius: 10, fontWeight: 600, cursor: 'pointer' }} onClick={() => handleGradeSelect('hard')}>Difficile</button>
            <button style={{ background: '#dbeafe', color: '#1d4ed8', border: 'none', padding: '14px 8px', borderRadius: 10, fontWeight: 600, cursor: 'pointer' }} onClick={() => handleGradeSelect('good')}>Correct</button>
            <button style={{ background: '#dcfce7', color: '#15803d', border: 'none', padding: '14px 8px', borderRadius: 10, fontWeight: 600, cursor: 'pointer' }} onClick={() => handleGradeSelect('easy')}>Facile</button>
          </div>
        </div>
      )}

      {currentCard && mode === 'feedback' && feedback && (
        <div style={{ ...s.card, background: feedback.success ? '#f0fdf4' : '#fef2f2' }}>
          <h3 style={{ color: feedback.success ? '#16a34a' : '#dc2626' }}>{feedback.success ? '✓ Acquis' : '✗ Échec'}</h3>
          <p>{feedback.message}</p>
          {!feedback.isLesson && (
            <div style={{ background: '#fff', borderRadius: 10, padding: 14, margin: '12px 0' }}>
              <strong style={{ fontSize: 11, color: '#94a3b8' }}>EXEMPLE</strong>
              <p style={{ margin: '6px 0 0' }}>{currentCard.exemple}</p>
            </div>
          )}
          <button style={s.btnPrimary} onClick={getNextCard}>Notion suivante →</button>
        </div>
      )}
    </div>
  );
}
