# API externe

Permet à des systèmes externes (ERP, GTB, télérelève, partenaires) de **lire** et d'**écrire** des données Zenergya.
Spécification OpenAPI 3.1 : **`/api/v1/openapi.json`** (générée depuis la description des imports : mêmes champs,
mêmes formats, mêmes valeurs possibles).

## Clés d'API

Menu **Accès API** (administrateurs) : une clé **par système externe**, avec :

- des **droits par ressource** (`clients:read`, `clients:write`, `sites:read`, `sites:write`, `contacts:…`,
  `meters:…`) — l'écriture n'implique pas la lecture ;
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

- **Représentation** : codes et noms Zenergya (client, site, contrat, société, agence…), jamais les identifiants
  internes de rattachement. Ce qui se lit peut se renvoyer tel quel (champs en lecture seule ignorés : `id` d'un
  contact, `unit` d'un compteur).
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

1. Relevés de compteurs (envoi depuis la télérelève / GTB).
2. Lecture des contrats, devis, factures (et PDF), affaires P6.
3. Webhooks : notification signée (HMAC) lors d'un événement (facture émise, devis accepté, situation facturée).
