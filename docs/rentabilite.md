# Rentabilité des affaires de travaux

Chaque affaire (P5 ou P6) rapproche, **par nature de dépense** (fournitures, main-d'œuvre, sous-traitance, divers) :

| | D'où vient le chiffre |
|---|---|
| **Prévu** | déboursé des devis de l'affaire (devis initial et devis complémentaires) |
| **Engagé** | lignes des commandes **validées** (ou passées, reçues, soldées) affectées à l'affaire ; pour la main-d'œuvre, coût des heures saisies. Les commandes en cours de validation sont indiquées à part, non comptées |
| **Réel** | factures des fournisseurs saisies sur ces commandes (réparties au prorata si la commande sert plusieurs affaires) ; coût des heures saisies |
| **Facturé** | factures émises au client (situations, ou acompte / solde / totalité des devis), hors annulées et proformas |

## Marge

- **Marge prévue** = prix de vente HT − déboursé prévu.
- **Coût à terminaison** : pour chaque nature, le plus grand du prévu et de l'engagé. Tant qu'une nature n'a pas
  dépassé son budget, on suppose qu'il sera consommé ; dès qu'elle le dépasse, le dépassement est compté.
- **Marge à terminaison** = prix de vente HT − coût à terminaison. Elle ne peut donc qu'être inférieure ou égale à la
  marge prévue : une économie sur une nature n'est constatée qu'à la fin de l'affaire.
- **Facturé − réel** : résultat constaté à ce jour (indicatif : il dépend de l'avancement de la facturation).

## Alertes

Nature dont l'engagé dépasse le prévu ; heures saisies supérieures aux heures prévues ; marge à terminaison négative ;
factures fournisseurs supérieures aux commandes.

## Où le voir

- **Fiche d'une affaire** : cartes Rentabilité (tableau par nature), Marge, Commandes de l'affaire, Heures de l'affaire
  (par technicien).
- **Liste des affaires** : facturé, engagé, marge prévue, marge à terminaison (en rouge si elle se dégrade, avec un
  avertissement en cas d'alerte).
- **Facturation › Suivi analytique** : ventes, achats et marge par axe, contrats compris (voir `analytique.md`).

Une affaire antérieure dont le budget n'a pas été enregistré n'a pas de prévu : seuls l'engagé, le réel et le facturé
s'affichent (`npm run affaires:reprise` complète le budget à partir des devis).

Code : `src/lib/projects/rentabilite.ts` (calcul, pur), `src/services/rentabilite-admin.ts`,
`src/components/projects/affaire-rentabilite.tsx`. Tests : `tests/rentabilite.test.ts`, `tests/rentabilite-flow.test.ts`.
