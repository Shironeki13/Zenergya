# Mise à jour automatique des indices

Les indices de révision (INSEE, PEG, CEE) sont récupérés automatiquement auprès de leurs sources, contrôlés, puis
enregistrés. Le même moteur sert à la **fonction planifiée** déployée dans GCP et au bouton « Synchroniser les indices »
de l'application (Facturation › Indices).

## Sources

| Indices | Source | Méthode |
|---|---|---|
| ICHT-TS, IC0-018Q, BT40, BT41, EBI, TCH | INSEE, banque de données macroéconomiques (`bdm.insee.fr`) | API officielle ouverte (SDMX), sans clé |
| CEE classique et précarité | EMMY, registre national des CEE (`emmy.fr`) | lecture de la page publique des données mensuelles |
| CEE classique et précarité | C2EMARKET | lecture de la page publique (contrôle de cohérence) |
| PEG | cnr.fr | lecture de la page — **bloquée par le site** (403) : saisie ou import en attendant une autre source |

Règle : API officielle d'abord ; lecture de page en dernier recours ; un blocage par le site ne se contourne pas.
Une source se déclare dans `src/lib/indices/registry.ts` (`famille` : statistique ou prix de marché ; `arretee` : série
d'une ancienne base, gardée pour l'historique).

Le site emmy.fr n'envoie pas son certificat intermédiaire : il est fourni dans
`src/lib/indices/fetchers/certificat-intermediaire-digicert.ts` (valable jusqu'en mars 2031) pour que le certificat du
site soit vérifié normalement. S'il change, la source EMMY passera en échec : remplacer ce certificat.

## Contrôles avant enregistrement (`src/lib/indices/controles.ts`)

- **Valeur plausible** : période lisible et non future, valeur positive, **variation** par rapport à la période
  précédente inférieure à 15 % pour un indice statistique et à 60 % pour un prix de marché. Une valeur hors de ces
  bornes est **rejetée** (non enregistrée) et signalée : elle se saisit à la main si elle est exacte.
- **Révision** : une valeur déjà enregistrée que la source a modifiée est mise à jour (avec l'ancienne valeur en
  commentaire), si elle reste plausible. Les factures déjà émises gardent la valeur qu'elles ont imprimée.
- **Retard** : un indice dont la prochaine valeur aurait dû paraître (selon sa fréquence observée, plus 4 mois pour un
  indice statistique, 2 pour un prix de marché) est signalé. Les séries arrêtées ne le sont pas.
- **Source en échec** (injoignable, bloquée, page modifiée, aucune valeur) : signalée ; les autres sources continuent.

## Journal

Chaque passage est enregistré (collection `indicesSyncs`, lue par le serveur) : par source, valeurs reçues, nouvelles,
révisées, rejetées, dernière période, retard, erreur. Le dernier passage s'affiche en haut de Facturation › Indices.

## Fonction planifiée (`functions/indices-sync`)

Cloud Function de 2ᵉ génération, **non publique**, appelée chaque jour par Cloud Scheduler avec un jeton de compte de
service (pas de secret partagé).

```bash
npm run functions:build                                   # construit functions/indices-sync/dist/index.js
PROJET=mon-projet ./scripts/indices-deployer.sh --essai   # affiche les commandes, sans rien exécuter
PROJET=mon-projet ./scripts/indices-deployer.sh           # déploie (demande confirmation)
```

Le script crée : deux comptes de service (`indices-sync`, qui n'a que le droit d'écrire dans Firestore ;
`indices-planificateur`, seul autorisé à appeler la fonction), la fonction, le déclencheur (tous les jours à 6 h, heure
de Paris ; `HORAIRE` pour changer) et un indicateur de journal `indices_sync_problemes`.

- **Essai sans écriture** : appeler la fonction avec `?dryRun=1` — elle interroge les sources et contrôle, sans rien
  enregistrer.
- **Alerte** : dans Cloud Monitoring, créer une règle d'alerte sur l'indicateur `indices_sync_problemes` (> 0) vers un
  canal de notification (e-mail). Cette règle n'est pas créée par le script.
- **Réponse** : 200 avec le rapport ; 502 si toutes les sources sont en échec (Cloud Scheduler relance) ; 500 si la
  synchronisation n'a pas pu s'exécuter.

L'appel planifié historique de l'application (`POST /api/indices/sync` avec `CRON_SECRET`) reste disponible ; la
fonction le remplace avantageusement (journaux, relances et droits séparés).

Tests : `tests/indices-controles.test.ts`, `tests/indices-sync-flow.test.ts`.
