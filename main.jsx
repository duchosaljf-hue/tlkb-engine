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
  onSnapshot,
} from 'firebase/firestore';

// ---- Firebase config (from the user's tlkb-engine-prod project) ----
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

// ---- Utilities ----
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

// ---- Styles (inline, no build-step CSS dependency) ----
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
  const [mode, setMode] = useState(null); // 'lesson' | null | 'qcm' | 'input' | 'feedback'
  const [qcmOptions, setQcmOptions] = useState([]);
  const [userInput, setUserInput] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [cycle, setCycle] = useState(0);

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

  const handleFileImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => importText(ev.target.result);
    reader.readAsText(file);
    e.target.value = '';
  };

  const getNextCard = useCallback(() => {
    const now = Date.now();
    const discovery = cards.filter((c) => (c.level || 0) === 0);
    const revision = cards.filter((c) => (c.level || 0) > 0 && (c.nextReview || 0) <= now);

    const eligibleDiscovery = discovery.filter((c) => {
      if (!c.prerequis) return true;
      return c.prerequis.split(';').filter(Boolean).every((id) => {
        const req = cards.find((x) => x.id === id);
        return req && (req.level || 0) >= 1;
      });
    }).sort((a, b) => {
      const pa = (parseInt(a.utilite) || 3) * 2 + (6 - (parseInt(a.difficulte) || 3));
      const pb = (parseInt(b.utilite) || 3) * 2 + (6 - (parseInt(b.difficulte) || 3));
      return pb - pa;
    });

    revision.sort((a, b) => (a.confidence || 0) - (b.confidence || 0));

    let next = null;
    const wantDiscovery = cycle >= 4;
    if (wantDiscovery && eligibleDiscovery.length) { next = eligibleDiscovery[0]; setCycle(0); }
    else if (revision.length) { next = revision[0]; setCycle((c) => c + 1); }
    else if (eligibleDiscovery.length) { next = eligibleDiscovery[0]; setCycle(0); }

    if (!next) { setCurrentCard(null); setMode(null); return; }
    setCurrentCard(next);
    setMode((next.level || 0) === 0 ? 'lesson' : null);
    setFeedback(null);
    setUserInput('');
  }, [cards, cycle]);

  const saveCard = async (updated) => {
    const ref = collection(db, 'users', user.uid, 'cards');
    await setDoc(doc(ref, updated.id), updated, { merge: true });
    setCurrentCard(updated);
  };

  const acknowledgeLesson = async () => {
    const updated = { ...currentCard, level: 1, confidence: 20, nextReview: Date.now() + 86400000 };
    await saveCard(updated);
    setFeedback({ success: true, isLesson: true, message: 'Notion intégrée au cycle de révision.' });
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

  const processResult = async (success, bonus) => {
    const now = Date.now();
    let level = currentCard.level || 0;
    let confidence = currentCard.confidence || 0;
    let days = 1;
    if (success) {
      level = Math.max(1, level);
      confidence = Math.min(100, confidence + bonus);
      days = Math.max(1, (confidence / 20) * (level || 1));
    } else {
      confidence = Math.max(0, confidence - 20);
      days = 0;
    }
    await saveCard({ ...currentCard, level, confidence, nextReview: now + days * 86400000 });
    setMode('feedback');
  };

  const handleQcmSelect = (opt) => {
    const success = opt === currentCard.nom;
    setFeedback({ success, message: success ? 'Correct.' : `Réponse attendue : ${currentCard.nom}` });
    processResult(success, 10);
  };

  const handleInputSubmit = () => {
    const target = currentCard.nom;
    const limit = target.length <= 4 ? 0 : target.length <= 8 ? 1 : 2;
    let match = levenshtein(target, userInput) <= limit;
    if (!match && currentCard.alias) {
      match = currentCard.alias.split(';').some((a) => levenshtein(a, userInput) <= limit);
    }
    setFeedback({ success: match, message: match ? 'Excellente maîtrise.' : `Notion attendue : ${target}` });
    processResult(match, 20);
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

      {!currentCard && (
        <>
          {cards.length > 0 && (() => {
            const total = cards.length;
            const started = cards.filter((c) => (c.level || 0) > 0).length;
            const pct = Math.round((started / total) * 100);
            const now = Date.now();
            const due = cards.filter((c) => (c.level || 0) > 0 && (c.nextReview || 0) <= now).length;
            const newOnes = total - started;
            const avgConf = started
              ? Math.round(cards.filter((c) => (c.level || 0) > 0).reduce((sum, c) => sum + (c.confidence || 0), 0) / started)
              : 0;
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
                  <div style={{ background: '#f1f5f9', borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#334155' }}>{avgConf}%</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>confiance moy.</div>
                  </div>
                </div>
              </div>
            );
          })()}

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
              <button style={s.btnPrimary} onClick={getNextCard}>Démarrer la session</button>
            </div>
          )}
        </>
      )}

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
          <span style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase' }}>Révision — confiance {currentCard.confidence || 0}%</span>
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
