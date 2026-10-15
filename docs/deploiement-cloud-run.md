# Déploiement sur Cloud Run

Le dépôt contient :

- `Dockerfile` : image de production (Next.js en mode `standalone`, Node 20, utilisateur non root, port 8080) ;
- `cloudbuild.yaml` : build de l'image, push vers Artifact Registry et déploiement sur le service Cloud Run.

## Configuration Firebase : lue au démarrage, pas au build

La configuration web Firebase (`NEXT_PUBLIC_FIREBASE_*`) est lue **à l'exécution** dans les variables du service Cloud Run,
puis transmise au navigateur par `/api/firebase-config`. L'image n'a donc besoin d'aucune variable au build :
**le déclencheur créé automatiquement par Cloud Run (type « Dockerfile ») fonctionne tel quel.**

`cloudbuild.yaml` reste disponible si vous préférez un déclencheur basé sur un fichier ; les substitutions
`_NEXT_PUBLIC_FIREBASE_*` y sont alors facultatives.

## Configuration (une seule fois)

### 1. Déclencheur Cloud Build

Le déclencheur créé par Cloud Run (« Déployer en continu depuis un dépôt », type Dockerfile) convient : rien à modifier,
il suffit qu'il surveille la bonne branche (`master`).

### 2. Service Cloud Run

Cloud Run → `zenergy` → Modifier et déployer une nouvelle révision :

- **Variables et secrets** (lus à l'exécution, conservés d'un déploiement à l'autre) :
  - configuration web Firebase : `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`,
    `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`,
    `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`
    (valeurs : console Firebase → Paramètres du projet → Vos applications → application Web) ;
  - `GEMINI_API_KEY` → secret Secret Manager ;
  - `ADMIN_EMAILS` → votre email (voir `docs/securite.md`) ;
  - `CRON_SECRET` → secret Secret Manager.
- **Ressources** : 1 Gio de mémoire conseillé ; `min-instances=1` évite le démarrage à froid (facturé en continu).
- **Compte de service du service** : rôles « Firebase Authentication Admin », « Cloud Datastore User »,
  « Secret Manager Secret Accessor » et « Storage Object User » (archivage des PDF de factures dans le bucket
  `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, ou `FIREBASE_STORAGE_BUCKET` s'il est différent).

### 3. Firebase Authentication

Console Firebase → Authentication → Paramètres → **Domaines autorisés** : ajouter l'URL du service
(`zenergy-….europe-west9.run.app`) ou votre domaine personnalisé, sinon la connexion Google est refusée.

### 4. Sécurité

Suivre ensuite `docs/securite.md` (inscription libre désactivée, utilisateurs, puis déploiement des règles **en dernier**).

## Remarques

- Au premier build, l'étape « Pull » du déclencheur automatique affiche `manifest … not found` : c'est normal (pas encore d'image en cache).
- Build local : `docker build -t zenergya .` puis
  `docker run -p 8080:8080 --env-file .env.local -e GOOGLE_APPLICATION_CREDENTIALS=/key.json -v $PWD/key.json:/key.json zenergya`.
- Vérifier la configuration servie : `https://<service>/api/firebase-config` doit afficher les valeurs du projet.
