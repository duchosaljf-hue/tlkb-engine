import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, deleteDoc } from 'firebase/firestore';
const firebaseConfig = typeof __firebase_config !== 'undefined'
? JSON.parse(__firebase_config)
: { apiKey: "demo-key", authDomain: "demo.firebaseapp.com", projectId: "demo-project" };
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'tlkb-engine-default';
export default function App() {
const [user, setUser] = useState(null);
const [isLogin, setIsLogin] = useState(true);
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');
const [fiches, setFiches] = useState([]);
const [searchQuery, setSearchQuery] = useState('');
const [loading, setLoading] = useState(true);
const [notification, setNotification] = useState(null);
useEffect(() => {
const initAuth = async () => {
try {
if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
await signInWithCustomToken(auth, __initial_auth_token);
} else {
await signInAnonymously(auth);
}
} catch (err) {
console.error("Erreur d'authentification:", err);
}
};
initAuth();
const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
setUser(currentUser);
setLoading(false);
});
return () => unsubscribe();
}, []);
useEffect(() => {
if (!user) return;
const collectionRef = collection(db, 'artifacts', appId, 'users', user.uid, 'fiches');
const unsubscribeSnapshot = onSnapshot(collectionRef, (snapshot) => {
const items = [];
snapshot.forEach((docSnap) => {
items.push({ id: docSnap.id, ...docSnap.data() });
});
setFiches(items);
}, (error) => {
console.error("Erreur Firestore:", error);
});
return () => unsubscribeSnapshot();
}, [user]);
const showNotification = (msg) => {
setNotification(msg);
setTimeout(() => setNotification(null), 3500);
};
const handleAuthSubmit = (e) => {
e.preventDefault();
showNotification("Authentification réussie.");
};
const handleLogout = async () => {
try {
await signOut(auth);
showNotification("Déconnexion effectuée.");
} catch (err) {
console.error("Erreur de déconnexion", err);
}
};
const ajouterFicheExemple = async () => {
if (!user) return;
try {
const collectionRef = collection(db, 'artifacts', appId, 'users', user.uid, 'fiches');
await addDoc(collectionRef, {
titre: Fiche TLKB #${fiches.length + 1},
contenu: "Contenu technique de la base de connaissances unifiée.",
date: new Date().toISOString()
});
showNotification("Nouvelle fiche ajoutée !");
} catch (err) {
console.error("Erreur d'ajout", err);
}
};
const fichesFiltrees = fiches.filter(f =>
f.titre?.toLowerCase().includes(searchQuery.toLowerCase()) ||
f.contenu?.toLowerCase().includes(searchQuery.toLowerCase())
);
if (loading) {
return (
<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0f172a', color: '#fff', fontFamily: 'sans-serif' }}>
<p>Chargement du Moteur TLKB...</p>
</div>
);
}
return (
<div style={{ fontFamily: 'sans-serif', background: '#f8fafc', color: '#0f172a', minHeight: '100vh', padding: '20px' }}>
{notification && (
<div style={{ position: 'fixed', top: '20px', right: '20px', background: '#4f46e5', color: '#fff', padding: '12px 20px', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 1000 }}>
{notification}
</div>
)}
<header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', padding: '16px 24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: '24px' }}>
<h1 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0 }}>Moteur TLKB</h1>
{user && (
<button onClick={handleLogout} style={{ background: '#ffe4e6', color: '#e11d48', border: 'none', padding: '8px 16px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
Déconnexion
</button>
)}
</header>
<main style={{ maxWidth: '800px', margin: '0 auto' }}>
{!user ? (
<div style={{ background: '#fff', padding: '32px', borderRadius: '16px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', textAlign: 'center' }}>
<h2 style={{ marginBottom: '16px' }}>Connexion</h2>
<form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
<input
type="email"
value={email}
onChange={(e) => setEmail(e.target.value)}
placeholder="E-mail"
required
style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
/>
<input
type="password"
value={password}
onChange={(e) => setPassword(e.target.value)}
placeholder="Mot de passe"
required
style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
/>
<button type="submit" style={{ background: '#4f46e5', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
{isLogin ? 'Se connecter' : "S'inscrire"}
</button>
</form>
<button onClick={() => setIsLogin(!isLogin)} style={{ background: 'none', border: 'none', color: '#4f46e5', marginTop: '12px', cursor: 'pointer' }}>
{isLogin ? "Créer un compte" : "Déjà un compte ? Se connecter"}
</button>
</div>
) : (
<div>
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
<input
type="text"
value={searchQuery}
onChange={(e) => setSearchQuery(e.target.value)}
placeholder="Rechercher une fiche..."
style={{ padding: '10px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', width: '60%' }}
/>
<button onClick={ajouterFicheExemple} style={{ background: '#4f46e5', color: '#fff', border: 'none', padding: '10px 16px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
+ Ajouter une fiche
</button>
</div>
<div style={{ display: 'grid', gap: '16px' }}>
{fichesFiltrees.length === 0 ? (
<p style={{ textAlign: 'center', color: '#64748b', padding: '40px' }}>Aucune fiche enregistrée.</p>
) : (
fichesFiltrees.map((fiche) => (
<div key={fiche.id} style={{ background: '#fff', padding: '20px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
<h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>{fiche.titre}</h3>
<p style={{ margin: '0 0 16px 0', color: '#475569' }}>{fiche.contenu}</p>
<button
onClick={async () => {
await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'fiches', fiche.id));
showNotification("Fiche supprimée.");
}}
style={{ background: '#fee2e2', color: '#dc2626', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}
>
Supprimer
</button>
</div>
))
)}
</div>
</div>
)}
</main>
</div>
);
}
