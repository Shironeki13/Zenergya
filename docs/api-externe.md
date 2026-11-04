# API externe (proposition)

Objectif : permettre à des systèmes externes (ERP, outils métier, partenaires) de **lire** et d'**envoyer** des
données à Zenergya, de façon sûre et traçable. À valider avant réalisation.

## Principes

- **REST + JSON**, versionnée : `/api/v1/…`. Spécification **OpenAPI 3** publiée (`/api/v1/openapi.json`) et
  documentation lisible par les équipes partenaires.
- **Mêmes règles que l'application** : la logique de contrôle et d'écriture est celle des imports et des écrans
  (même validation, mêmes codes CLI / SIT / CPT, mêmes transitions de statut), jamais une écriture directe en base.
- **Identifiants Zenergya** (codes CLI, SIT, CPT, CTN, numéros de devis et de factures) dans les échanges.

## Sécurité

- **Une clé d'API par système externe**, créée par un administrateur (écran « Accès API »), affichée une seule
  fois, stockée **hachée** (jamais en clair), révocable, avec date d'expiration.
- **Droits par clé et par ressource** : `clients:read`, `clients:write`, `sites:read`, `meters:write`,
  `readings:write`, `invoices:read`… (principe du moindre privilège), éventuellement limités à une société.
- Transport **HTTPS** uniquement ; en-tête `Authorization: Bearer <clé>`.
- **Limite de débit** par clé (ex. 60 requêtes / minute), réponses 429 avec `Retry-After`.
- **Journal** de chaque appel (clé, ressource, statut, durée) ; alertes sur les échecs répétés.

## Ressources envisagées

| Ressource | Lecture | Écriture |
| --- | --- | --- |
| Clients, sites, contacts, compteurs | liste filtrée et paginée, détail | création / mise à jour (mêmes règles que l'import) |
| Relevés de compteurs | liste par compteur et période | envoi de relevés (télérelève, GTB) |
| Contrats | liste, détail | — (dans un second temps) |
| Devis, factures, avoirs | liste, détail, PDF | — (émission réservée à l'application) |
| Affaires P6 et situations | liste, détail | — |

## Robustesse

- **Pagination** par curseur (`?limit=100&cursor=…`), filtres par date de modification (`updatedSince`) pour les
  synchronisations incrémentales.
- **Idempotence** des écritures : en-tête `Idempotency-Key` ; un envoi répété (réseau instable) n'est pas traité
  deux fois.
- **Lots** : écriture de plusieurs éléments par appel, avec un résultat par élément (comme le rapport d'import).
- **Erreurs** normalisées (code, message, champ en cause).
- **Webhooks** (ensuite) : notification signée (HMAC) d'un système externe lors d'un événement (facture émise,
  devis accepté, situation facturée), avec nouvelles tentatives.

## Réalisation proposée

1. Clés d'API (création, hachage, droits, révocation, journal) et lecture des clients / sites / compteurs.
2. Écriture clients / sites / contacts / compteurs (réutilise le moteur d'import), relevés de compteurs.
3. Lecture devis / factures / affaires ; spécification OpenAPI complète.
4. Webhooks.
