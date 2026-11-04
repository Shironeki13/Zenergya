# Zenergya

Application de gestion des contrats et de la facturation (Next.js, Firebase, Genkit).

- Démarrer en local : `npm install`, copier `.env.example` en `.env.local`, puis `npm run dev` (port 9002).
- Vérifications : `npm run typecheck`, `npm test` (arrondis), `npm run test:billing` et `npm run test:rules` (émulateur Firestore).
- Numérotation des factures, avoirs et arrondis : voir [docs/facturation.md](docs/facturation.md).
- Facturation électronique (régimes, adressage, tableau de bord) : voir [docs/facturation-electronique.md](docs/facturation-electronique.md).
- Paramétrage P1 (ce qu'il faut saisir sur contrats, sites et compteurs pour calculer le P1) : voir [docs/parametrage-p1.md](docs/parametrage-p1.md).
- Développement avec les émulateurs Firebase : `FIREBASE_WEB_EMULATOR_HOST=127.0.0.1` (voir `.env.example`).
- Sécurité, droits et mise en service : voir [docs/securite.md](docs/securite.md).
- Codes Zenergya des sites (`SIT-00001`) et des compteurs (`CPT-00001`) : attribués à la création, immuables. Pour coder les documents existants : `npm run codes:attribuer` (simulation), puis `npm run codes:attribuer -- --apply`.
- Répertoire des entreprises (recherche et vérification SIRET via l'API de l'État) : voir [docs/repertoire-entreprises.md](docs/repertoire-entreprises.md).
- Devis (clients et prospects, chiffrage, coefficient et taux horaire par client) : voir [docs/devis.md](docs/devis.md).
- Affaires P6 (facturation à l'avancement par situations, retenue de garantie) : voir [docs/affaires-p6.md](docs/affaires-p6.md).
- Bibliothèque de prix (articles, ouvrages, import CSV des tarifs) : voir [docs/bibliotheque-prix.md](docs/bibliotheque-prix.md).
- Imports en masse (clients, sites, contacts, compteurs, relevés ; modèles CSV et Excel) : voir [docs/imports.md](docs/imports.md).
- API externe (clés d'accès, lecture et écriture des clients, sites, contacts, compteurs, relevés ; OpenAPI) : voir [docs/api-externe.md](docs/api-externe.md).
- Déploiement Cloud Run (Dockerfile, Cloud Build) : voir [docs/deploiement-cloud-run.md](docs/deploiement-cloud-run.md).
