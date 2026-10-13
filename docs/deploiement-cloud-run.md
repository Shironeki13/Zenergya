# Déploiement sur Cloud Run

Le dépôt contient :

- `Dockerfile` : image de production (Next.js en mode `standalone`, Node 20, utilisateur non root, port 8080) ;
- `cloudbuild.yaml` : build de l'image, push vers Artifact Registry et déploiement sur le service Cloud Run.

## Pourquoi un `cloudbuild.yaml` ?

La configuration web Firebase (`NEXT_PUBLIC_FIREBASE_*`) est intégrée au JavaScript du navigateur **au moment du build**.
Elle doit donc être passée au `docker build` ; la définir seulement comme variable d'environnement du service Cloud Run ne suffit pas.
Le déclencheur créé automatiquement par Cloud Run ne transmet pas ces valeurs ; le `Dockerfile` s'arrête alors avec un message explicite
plutôt que de déployer une application qui ne peut pas se connecter.

## Configuration (une seule fois)

### 1. Déclencheur Cloud Build

Console Google Cloud → Cloud Build → Déclencheurs → déclencheur du service `zenergy` → Modifier :

- **Branche** : celle qui contient le `Dockerfile` (après fusion, `master`).
- **Configuration** : « Fichier de configuration Cloud Build (YAML ou JSON) », emplacement `/cloudbuild.yaml`.
- **Variables de substitution** (valeurs : console Firebase → Paramètres du projet → Vos applications → application Web → Configuration) :

| Variable | Exemple |
| --- | --- |
| `_NEXT_PUBLIC_FIREBASE_API_KEY` | `AIza…` |
| `_NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `zenergy-f8276.firebaseapp.com` |
| `_NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `zenergy-f8276` |
| `_NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `zenergy-f8276.appspot.com` |
| `_NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `123456789` |
| `_NEXT_PUBLIC_FIREBASE_APP_ID` | `1:123456789:web:…` |
| `_NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | `G-…` (facultatif) |

Les valeurs par défaut de `cloudbuild.yaml` (`_SERVICE_NAME=zenergy`, `_DEPLOY_REGION=europe-west9`, dépôt `cloud-run-source-deploy`)
correspondent au service existant ; les surcharger dans le déclencheur si besoin.

Le compte de service du déclencheur doit avoir : Cloud Run Admin, Service Account User, Artifact Registry Writer
(c'est normalement déjà le cas pour un déclencheur créé depuis Cloud Run).

### 2. Service Cloud Run

Cloud Run → `zenergy` → Modifier et déployer une nouvelle révision :

- **Variables et secrets** (lus à l'exécution, conservés d'un déploiement à l'autre) :
  - `GEMINI_API_KEY` → secret Secret Manager ;
  - `ADMIN_EMAILS` → votre email (voir `docs/securite.md`) ;
  - `CRON_SECRET` → secret Secret Manager.
- **Ressources** : 1 Gio de mémoire conseillé ; `min-instances=1` évite le démarrage à froid (facturé en continu).
- **Compte de service du service** : rôles « Firebase Authentication Admin », « Cloud Datastore User »,
  « Secret Manager Secret Accessor ».

### 3. Firebase Authentication

Console Firebase → Authentication → Paramètres → **Domaines autorisés** : ajouter l'URL du service
(`zenergy-….europe-west9.run.app`) ou votre domaine personnalisé, sinon la connexion Google est refusée.

### 4. Sécurité

Suivre ensuite `docs/securite.md` (inscription libre désactivée, utilisateurs, puis déploiement des règles **en dernier**).

## Remarques

- Au premier build, l'étape « Pull » du déclencheur automatique affiche `manifest … not found` : c'est normal (pas encore d'image en cache).
- Build local : `docker build --build-arg NEXT_PUBLIC_FIREBASE_API_KEY=… [autres --build-arg] -t zenergya .` puis
  `docker run -p 8080:8080 -e GOOGLE_APPLICATION_CREDENTIALS=/key.json -v $PWD/key.json:/key.json zenergya`.
