# Zenergya

Application de gestion des contrats et de la facturation (Next.js, Firebase, Genkit).

- Démarrer en local : `npm install`, copier `.env.example` en `.env.local`, puis `npm run dev` (port 9002).
- Vérifications : `npm run typecheck`, `npm test` (arrondis), `npm run test:billing` et `npm run test:rules` (émulateur Firestore).
- Numérotation des factures, avoirs et arrondis : voir [docs/facturation.md](docs/facturation.md).
- Sécurité, droits et mise en service : voir [docs/securite.md](docs/securite.md).
- Déploiement Cloud Run (Dockerfile, Cloud Build) : voir [docs/deploiement-cloud-run.md](docs/deploiement-cloud-run.md).
