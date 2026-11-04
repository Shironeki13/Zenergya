# API externe

Permet à des systèmes externes (ERP, GTB, télérelève, partenaires) de **lire** et d'**écrire** des données Zenergya.
Spécification OpenAPI 3.1 : **`/api/v1/openapi.json`** (générée depuis la description des imports : mêmes champs,
mêmes formats, mêmes valeurs possibles).

## Clés d'API

Menu **Accès API** (administrateurs) : une clé **par système externe**, avec :

- des **droits par ressource** (`clients:read`, `clients:write`, `sites:read`, `sites:write`, `contacts:…`,
  `meters:…`, `readings:…`) — l'écriture n'implique pas la lecture ;
- une **limite de débit** (appels par minute, 120 par défaut) et une **date d'expiration** facultative ;
- la **révocation** immédiate.

La clé (`zen_<préfixe>_<secret>`) n'est affichée **qu'une fois**, à sa création : seule l'empreinte SHA-256 du
secret est conservée. Le préfixe identifie la clé dans les écrans et le journal.

## Utilisation

```bash
# Liste paginée (50 par défaut, 200 au plus), filtres selon la ressource
curl -H "Authorization: Bearer $ZEN_KEY" "https://<zenergya>/api/v1/sites?client=CLI-00012&limit=100"
# Page suivante : &cursor=<nextCursor>

# Détail par code Zenergya (identifiant pour un contact)
curl -H "Authorization: Bearer $ZEN_KEY" "https://<zenergya>/api/v1/clients/CLI-00012"

# Création / mise à jour par lot (500 éléments au plus)
curl -X POST -H "Authorization: Bearer $ZEN_KEY" -H "Content-Type: application/json" \
     -H "Idempotency-Key: import-2026-11-04-001" \
     -d '[{"client":"CLI-00012","name":"Résidence A","siteNumber":"01","address":"1 rue A","postalCode":"69001","city":"Lyon"}]' \
     "https://<zenergya>/api/v1/sites"
```

| Ressource | Filtres de liste | Détail par |
| --- | --- | --- |
| `clients` | `siret`, `relation` | code CLI |
| `sites` | `client` (code CLI) | code SIT |
| `contacts` | `client` (code CLI) | identifiant |
| `meters` | `site` (code SIT) | code CPT |
| `readings` | `meter` (code CPT), `site` (code SIT), `from`, `to` | identifiant |

- **Représentation** : codes et noms Zenergya (client, site, contrat, société, agence…), jamais les identifiants
  internes de rattachement. Ce qui se lit peut se renvoyer tel quel (champs en lecture seule ignorés : `id` d'un
  contact ou d'un relevé, `unit`, `source` et `contract` d'un relevé, `unit` d'un compteur).
- **Écriture** : exactement les contrôles de l'**import de fichiers** (voir `imports.md`) — correspondance par code
  (sinon SIRET, client + n° de site, client + email, site + PDL), références vérifiées, codes attribués par
  Zenergya ; un champ absent ou vide conserve la valeur existante. Réponse : `summary` et un résultat **par
  élément** (`created`, `updated`, `unchanged` avec le code attribué, ou `error` avec les motifs). Chaque appel
  d'écriture est aussi tracé dans les imports (source « api »).
- **Idempotence** : avec l'en-tête `Idempotency-Key`, un envoi répété (24 h) rend la même réponse sans rien
  réécrire (en-tête `Idempotent-Replayed: true`) ; la même clé avec une autre requête est refusée (422).
- **Débit** : en-têtes `X-RateLimit-Limit` / `X-RateLimit-Remaining` ; au-delà, 429 avec `Retry-After`.

### Erreurs

`{ "error": { "code": "...", "message": "...", "details": ... } }`

| Statut | Code | Cas |
| --- | --- | --- |
| 400 | `invalid_json`, `invalid_body`, `unknown_field`, `invalid_parameter` | requête mal formée |
| 401 | `unauthorized` | clé absente, invalide, révoquée ou expirée |
| 403 | `forbidden` | droit non accordé à la clé |
| 404 | `not_found` | ressource ou élément inconnu |
| 413 | `payload_too_large`, `too_many_items` | plus de 2 Mo ou de 500 éléments |
| 422 | `idempotency_conflict` | clé d'idempotence réutilisée pour une autre requête |
| 429 | `rate_limited` | limite de débit atteinte |

## Relevés de compteurs

Pour la télérelève, la GTB ou la reprise d'historique (aussi importables par fichier : menu Imports).

```bash
# Envoi (un relevé par compteur et par instant ; 500 au plus par appel)
curl -X POST -H "Authorization: Bearer $ZEN_KEY" -H "Content-Type: application/json" \
     -H "Idempotency-Key: telereleve-2025-02-01" \
     -d '[{"meter":"CPT-00012","date":"2025-02-01T06:00:00+01:00","value":125430,"type":"AUTO"}]' \
     "https://<zenergya>/api/v1/readings"

# Lecture d'une période, du plus ancien au plus récent (from inclus, to exclu)
curl -H "Authorization: Bearer $ZEN_KEY" "https://<zenergya>/api/v1/readings?meter=CPT-00012&from=2025-01-01&to=2026-01-01"
```

- **Date** : ISO 8601 avec fuseau (`2025-02-01T06:00:00+01:00`, `…Z`), ou `AAAA-MM-JJ` / `JJ/MM/AAAA` avec heure
  facultative, lue en **heure de Paris** (sans heure : minuit). Rendue en UTC (`2025-01-31T23:00:00.000Z`).
- **Correspondance** : compteur + instant exact. Renvoyer un relevé au même instant le met à jour (index, type,
  commentaire) ; un relevé relu peut être renvoyé tel quel (sans effet).
- **Index** : nombre positif ou nul, dans l'unité du compteur. Type : `REEL` (par défaut), `ESTIME`, `CORRIGE`,
  `AUTO` (télérelève). Origine enregistrée : `API` (`IMPORT` pour un fichier, `MANUEL` à l'écran).
- **Contrôles** : compteur connu, date valide et non future, pas deux fois le même instant dans un envoi. Un relevé
  repris dans un **intéressement** ou une **régularisation** garde son index (modification refusée ; le commentaire
  reste modifiable).
- **Avertissements** (relevé écrit quand même, champ `warnings` du résultat) : index inférieur au relevé précédent
  ou supérieur au suivant (remplacement ou remise à zéro du compteur, correction), compteur hors service.
- Le **contrat** est celui du site à la création du relevé.
- **Mise en service** : déployer l'index composite (`firestore.indexes.json`, avec les règles :
  `firebase deploy --only firestore`), puis convertir une fois les dates enregistrées en texte par d'anciennes
  modifications à l'écran, sinon elles échappent aux filtres `from` / `to` :
  `npm run releves:normaliser` (simulation), puis `npm run releves:normaliser -- --apply`.

## Exploitation

- Collections **réservées au serveur** (ni lecture ni écriture navigateur) : `apiKeys`, `apiUsage`,
  `apiIdempotency`, `apiLogs`.
- **Journal** : chaque appel (clé, méthode, chemin, statut, durée), consultable dans « Accès API », conservé 90 jours.
- **Purge automatique** à activer une fois par projet (politiques TTL Firestore) :
  ```bash
  gcloud firestore fields ttls update expireAt  --collection-group=apiLogs        --enable-ttl
  gcloud firestore fields ttls update expiresAt --collection-group=apiIdempotency --enable-ttl
  ```
- La limite de débit est partagée entre les instances du serveur (compteur Firestore par clé).

## À venir

1. Lecture des contrats, devis, factures (et PDF), affaires P6.
2. Webhooks : notification signée (HMAC) lors d'un événement (facture émise, devis accepté, situation facturée).
