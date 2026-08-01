# TLKB Engine — instructions de déploiement

Ce dossier a été testé : `npm install` puis `npm run build` fonctionnent
sans aucune erreur (build Vite, ~4 secondes). C'est un projet **Vite**,
pas Create React App — plus léger, plus rapide à installer, et c'est le
préréglage que Vercel détecte automatiquement, sans configuration à faire.

## Étape 1 — Remplacer le contenu de votre dépôt GitHub

Sur votre dépôt `tlkb-engine`, supprimez tout ce qui existe actuellement
(dossier `src`, `public`, anciens `package.json`, `index.html` à la racine)
et uploadez exactement les fichiers de ce dossier, en conservant l'arborescence :

```
tlkb-web/
├── index.html
├── package.json
├── vite.config.js
├── .gitignore
└── src/
    ├── main.jsx
    └── App.jsx
```

Le plus simple sur iPad : dans GitHub, utilisez le bouton **Add file →
Upload files**, puis glissez ces fichiers un par un (en respectant bien
que `main.jsx` et `App.jsx` aillent dans un dossier `src`).

## Étape 2 — Vercel

Sur Vercel, dans les paramètres du projet (Settings → General →
Build & Development Settings), assurez-vous que le **Framework Preset**
est bien sur **Vite** (il devrait être détecté automatiquement dès que
`vite.config.js` est présent). Ne laissez pas "Create React App" sélectionné
manuellement — c'est la cause de vos erreurs `exit code 127`.

Cliquez sur **Redeploy** en décochant "Use existing Build Cache".

## Étape 3 — Domaines autorisés Firebase

Une fois l'URL Vercel obtenue (ex. `tlkb-engine.vercel.app`), ajoutez-la
dans Firebase Console → Authentication → Settings → Authorized domains.

## Étape 4 — Règles de sécurité Firestore

Important avant d'ouvrir l'app publiquement : dans Firebase Console →
Firestore Database → Rules, utilisez au minimum :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/cards/{cardId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Sans ces règles, n'importe quel utilisateur connecté pourrait lire ou
modifier les fiches de n'importe quel autre utilisateur.

## Ce que contient l'application

- Connexion par e-mail/mot de passe et par Google.
- Chaque compte a ses propres fiches, stockées dans
  `users/{uid}/cards/{id}` sur Firestore.
- Import CSV strict au format 19 colonnes (le même en-tête que vous
  utilisez déjà avec votre IA génératrice) :
  `id,type,nom,definition,exemple,auteur,domaine,sous_domaine,difficulte,utilite,famille,contraire,origine,tags,liens,alias,prerequis,pieges,applications`
- Moteur de révision : découverte (leçon complète) → QCM ou saisie libre →
  espacement selon la confiance, avec priorité aux fiches à forte utilité
  et faible difficulté, comme dans votre spécification fonctionnelle v1.2.
