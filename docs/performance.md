# Chargement des données

Les écrans partagent des données chargées une fois par `DataProvider` (`src/context/data-context.tsx`) et lues par
`useData()`.

## Ce qui est chargé, et quand

| | Collections | Quand |
|---|---|---|
| **À l'ouverture** | référentiels (sociétés, agences, secteurs, activités, TVA, échéanciers, termes, typologies, marchés, règles de révision, de prix et de règlement, indices, types de compteurs, stations météo, rôles, utilisateurs) et listes de base (clients, contrats, sites, prestations) | à la connexion |
| **À la demande** | factures, avoirs, relevés de compteurs, valeurs d'indices, contacts, compteurs | au premier écran qui en a besoin ; gardées ensuite en mémoire |

Un écran qui lit une collection « à la demande » la déclare :

```tsx
const { invoices, isLoading: chargementBase } = useData();
const pret = useCollections('invoices');          // demande le chargement ; true quand c'est en mémoire
const isLoading = chargementBase || !pret;
```

- L'application retient, par écran, les collections demandées (stockage local du navigateur) : à l'ouverture directe
  de cet écran, elles sont chargées en même temps que le reste.
- Les composants toujours affichés ne demandent ces collections que lorsqu'elles servent : la recherche globale à son
  ouverture (`useCollectionsPonctuelles`), le fil d'Ariane sur la fiche d'une facture.
- Les écrans qui lisent leurs propres données (fiche contrat, devis, affaires, commandes, heures…) ne passent pas par
  ce mécanisme.

## Après un enregistrement

- `reloadData(['clients', 'contacts'])` : ne recharge que les collections citées, **sans écran d'attente** (l'écran
  reste affiché, les boîtes de dialogue se ferment par le code de l'écran). Une collection « à la demande » que
  personne n'a demandée n'est pas rechargée.
- `reloadData()` sans argument : recharge tout ce qui est en mémoire, avec l'écran d'attente. Réservé aux opérations
  qui touchent tout (imports en masse).

Pour ajouter une collection partagée : son chargeur dans `LOADERS`, sa clé dans `EAGER_COLLECTIONS` ou
`LAZY_COLLECTIONS` (`src/lib/types.ts`) et son type dans `DataContextType`.

## Mesures (jeu de démonstration, ouverture directe d'un écran)

| | Avant | Après |
|---|---|---|
| Collections lues à l'ouverture | 49 | 23 (+ celles de l'écran) |
| Documents lus à l'ouverture de la liste des clients | ≈ 1 020 | ≈ 130 |

Les temps d'ouverture mesurés figurent dans le compte rendu du lot ; ils dépendent du volume de données.

## Limite connue

Les factures, avoirs et relevés sont encore chargés **en entier** par les écrans qui les utilisent. Avec plusieurs
années de données réelles, il faudra les charger par période (requêtes bornées, pagination).
