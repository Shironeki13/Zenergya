# Chargement des données

Les écrans partagent des données chargées une fois par `DataProvider` (`src/context/data-context.tsx`) et lues par
`useData()`.

## Ce qui est chargé, et quand

| | Collections | Quand |
|---|---|---|
| **À l'ouverture** | référentiels (sociétés, agences, secteurs, activités, TVA, échéanciers, termes, typologies, marchés, règles de révision, de prix et de règlement, indices, types de compteurs, stations météo, rôles, utilisateurs) et listes de base (clients, contrats, sites, prestations) | à la connexion |
| **À la demande** | valeurs d'indices, contacts, compteurs | au premier écran qui en a besoin ; gardées ensuite en mémoire |
| **Jamais en entier** | relevés de compteurs, factures, avoirs | lus par compteur, par site, par période ou par objet (lectures nommées) |

Les collections **à périmètre** (clients, contrats, sites, prestations, compteurs, relevés, factures, avoirs, contacts)
sont lues par le serveur en **une seule requête** (`/api/donnees?c=…`), filtrées pour l'utilisateur ; les référentiels
sont lus directement dans la base. Voir `perimetre.md`.

Un écran qui lit une collection « à la demande » la déclare :

```tsx
const { meters, isLoading: chargementBase } = useData();
const pret = useCollections('meters');            // demande le chargement ; true quand c'est en mémoire
const isLoading = chargementBase || !pret;
```

- L'application retient, par écran, les collections demandées (stockage local du navigateur) : à l'ouverture directe
  de cet écran, elles sont chargées en même temps que le reste.
- Les composants toujours affichés ne demandent ces collections que lorsqu'elles servent : la recherche globale charge
  les compteurs à son ouverture (`useCollectionsPonctuelles`).
- Les écrans qui lisent leurs propres données (fiche contrat, devis, affaires, commandes, heures…) ne passent pas par
  ce mécanisme.

## Après un enregistrement

- `reloadData(['clients', 'contacts'])` : ne recharge que les collections citées, **sans écran d'attente** (l'écran
  reste affiché, les boîtes de dialogue se ferment par le code de l'écran). Une collection « à la demande » que
  personne n'a demandée n'est pas rechargée.
- `reloadData()` sans argument : recharge tout ce qui est en mémoire, avec l'écran d'attente. Réservé aux opérations
  qui touchent tout (imports en masse).

Pour ajouter une collection partagée : sa clé dans `EAGER_COLLECTIONS` ou `LAZY_COLLECTIONS` (`src/lib/types.ts`) et
son type dans `DataContextType` ; puis, pour un référentiel, son chargeur dans `LOADERS` et son nom dans
`firestore.rules` ; pour une collection à périmètre, son nom dans `COLLECTIONS_PERIMETRE` et son filtre dans
`src/services/donnees-admin.ts`.

## Mesures (jeu de démonstration, ouverture directe d'un écran)

| | Avant | Après |
|---|---|---|
| Collections lues à l'ouverture | 49 | 23 (+ celles de l'écran) |
| Documents lus à l'ouverture de la liste des clients | ≈ 1 020 | ≈ 130 |

Les temps d'ouverture mesurés figurent dans le compte rendu du lot ; ils dépendent du volume de données.

## Relevés de compteurs

Les relevés sont le plus gros volume (un par compteur et par mois, sur des années) : ils ne sont jamais chargés en
entier par le navigateur.

- **Liste des compteurs** : le dernier relevé (date, index, type) est inscrit **sur le compteur**
  (`lastReadingDate`, `lastReadingValue`, `lastReadingType`), tenu à jour par le serveur à chaque saisie, modification,
  suppression ou import de relevé, API comprise (`majDerniersReleves`, `src/services/readings-admin.ts`).
- **Relevés d'un compteur** (dialogue) : lus à l'ouverture ; **fiche d'un site** : relevés de ses compteurs seulement.
- **Reprise de l'existant** : `npm run releves:reprise` (simulation), puis `-- --apply`, une fois, pour inscrire le
  dernier relevé sur les compteurs déjà en base.

## Factures et avoirs : par période

Les listes ne chargent plus tout l'historique (`src/hooks/use-lecture-periode.ts`, lectures `facturesDePeriode`,
`avoirsDePeriode`, `facturesImpayees`) :

- **Liste des factures** : la période choisie — par défaut **l'exercice en cours et le précédent** — plus les factures
  **impayées** et les **proformas**, quelle que soit leur date. Le sélecteur (`SelecteurPeriode`) propose l'année en
  cours, les deux dernières ou tout l'historique ; la période est retenue d'un écran à l'autre pendant la session.
- **Avoirs** : la période choisie ; le serveur joint les numéros des factures annulées.
- **Facturation électronique** : la période des filtres « Du / Au » (sans dates : la période par défaut), plus les
  documents **à transmettre ou rejetés**, quelle que soit leur date.
- **Suivi des encaissements** : les seules factures impayées.
- **Listes allégées** : le détail des lignes d'une facture (97 % de son poids) n'est pas transmis aux listes ; un
  indicateur `annexeP1` dit si le document a une annexe P1. La fiche d'une facture lit le document complet.
- **Fiche d'un client** : ses factures (liste allégée) ; **fiche d'un site** : les factures de son contrat (documents
  complets, le montant du site se lisant dans leurs lignes).
- **Tableau de bord** : une synthèse calculée au serveur (total facturé, 12 derniers mois, dernière période facturée
  par contrat, 5 dernières factures) — il ne reçoit pas la liste des factures.
- **Recherche globale** : factures cherchées au serveur par **début de numéro** (3 caractères au moins, 20 résultats).
- **Fil d'Ariane** : le seul numéro de la facture affichée.

## Limite connue

Côté serveur, certains calculs lisent encore des collections entières : la synthèse du tableau de bord (factures,
sur quelques champs), les alertes compteurs (relevés), la rentabilité des affaires (commandes, heures) et la
facturation groupée. À mesurer avec les volumes réels.
