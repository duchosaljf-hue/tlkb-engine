import React, { useState, useEffect, useMemo } from 'react';
import { Book, Brain, Users, BarChart2, CheckSquare, Plus, ChevronRight, RefreshCw, Eye, BookOpen, Hourglass, Lightbulb, MessageCircle, Quote, Download, Upload, Tag, Link as LinkIcon, Star, User as UserIcon, Folder, ArrowLeftRight, Library, Globe, AlertTriangle, Target, LogOut, Mail, Lock } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, onSnapshot } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyD4G2DU-XJhSU1LQ7JWawSLulagPeFi-cc",
  authDomain: "tlkb-engine-prod.firebaseapp.com",
  projectId: "tlkb-engine-prod",
  storageBucket: "tlkb-engine-prod.firebasestorage.app",
  messagingSenderId: "448945628707",
  appId: "1:448945628707:web:c5829517c1dea21033b396"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
const APP_ID = 'tlkb-engine-prod';

export default function App() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, setUser);
  }, []);

  const handleAuth = async (e) => {
    e.preventDefault();
    try {
      if (isLogin) await signInWithEmailAndPassword(auth, email, password);
      else await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) { console.error(err); }
  };

  const handleGoogle = async () => {
    try { await signInWithPopup(auth, provider); }
    catch (err) { console.error(err); }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md">
          <h2 className="text-2xl font-bold mb-6 text-center text-indigo-900">Connexion TLKB Engine</h2>
          <form onSubmit={handleAuth} className="space-y-4">
            <input type="email" placeholder="Email" className="w-full p-3 border rounded-lg" onChange={(e) => setEmail(e.target.value)} />
            <input type="password" placeholder="Mot de passe" className="w-full p-3 border rounded-lg" onChange={(e) => setPassword(e.target.value)} />
            <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold">{isLogin ? 'Se connecter' : 'S\'inscrire'}</button>
          </form>
          <div className="my-4 text-center text-slate-400">OU</div>
          <button onClick={handleGoogle} className="w-full border py-3 rounded-lg flex items-center justify-center font-medium">
            Continuer avec Google
          </button>
          <button onClick={() => setIsLogin(!isLogin)} className="w-full mt-4 text-sm text-indigo-600 text-center">
            {isLogin ? 'Besoin d\'un compte ? S\'inscrire' : 'Déjà inscrit ? Se connecter'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold text-indigo-900">TLKB Engine (Connecté)</h1>
          <button onClick={() => signOut(auth)} className="bg-slate-200 px-4 py-2 rounded-lg text-sm flex items-center gap-2">
            <LogOut className="w-4 h-4" /> Déconnexion
          </button>
        </header>
        <div className="bg-white p-8 rounded-2xl shadow-lg">
          <p className="text-lg">Bienvenue sur votre moteur TLKB personnel.</p>
          <p className="text-slate-500 mt-2">Votre base de données est désormais sécurisée dans le Cloud.</p>
        </div>
      </div>
    </div>
  );
}
