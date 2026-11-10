# Commandes d'achat

Une commande engage une dépense auprès d'un fournisseur. Chaque **ligne** est affectée à une **affaire de travaux** ou à
un **contrat (et une activité)** : elle porte donc le même code analytique que les ventes (voir `analytique.md`), ce qui
permettra de comparer prévu, engagé, réel et facturé.

Menu **Achats › Commandes** (`/purchases`).

## Circuit de validation

Le total HT de la commande détermine les validations, d'après les **seuils de la société** (bouton « Seuils », réservé
à l'administrateur ; par défaut 500 / 5 000 / 10 000 € HT) :

| Total HT | Validation |
|---|---|
| jusqu'au seuil d'autovalidation | aucune : la commande est validée à la soumission |
| au-delà | **N+1** : le responsable du demandeur |
| au-delà du seuil N+2 | N+1, puis **N+2** : le responsable du N+1 |
| au-delà du seuil achats | en plus, et en dernier : un utilisateur dont le rôle a le droit **Achats** |

- Le N+1 de chacun se renseigne dans **Utilisateurs** (« Responsable (N+1) ») ; le droit Achats, sur le **rôle**.
  Si un responsable manque, la soumission est refusée avec un message qui dit quoi compléter.
- Les étapes se suivent dans l'ordre. Un **refus** (motif obligatoire) renvoie la commande au demandeur, qui la corrige
  et la soumet à nouveau : le circuit repart du début.
- Personne ne valide **sa propre** commande. Un **administrateur** peut valider une étape à la place du valideur
  absent : la décision est marquée « en secours ».
- Les seuils appliqués sont **figés sur la commande** à la soumission : les changer ensuite ne modifie pas les
  commandes en cours.

## Vie d'une commande

`brouillon` → (soumission) → `à valider` → `validée` → `passée` au fournisseur → `reçue` → `soldée` ; `refusée` (retour
au demandeur) ; `annulée` (motif obligatoire, impossible dès qu'une facture fournisseur est saisie).

- **Numéro** attribué à la soumission : `{code société}-CMD{année}-{n°}` (ex. `ZEN-CMD2026-0004`).
- **Analytique figée à la soumission**, ligne par ligne : code de l'affaire, ou du contrat et de l'activité.
- **Factures du fournisseur** (numéro, date, montant HT) saisies sur une commande validée, passée ou reçue : leur somme
  est le **réel** ; « Solder » clôt la commande.
- **Engagé** : total des commandes validées, passées, reçues ou soldées. Les commandes à valider sont comptées à part.

## Fournisseurs

Bouton « Fournisseurs » de la liste, ou « + » dans la fiche d'une commande : raison sociale, SIRET, contact ; code
`FRN-00001` attribué ; un fournisseur inactif n'est plus proposé.

## À venir

Import Excel des commandes ; heures des techniciens par affaire ; rentabilité par affaire (prévu / engagé / réel /
facturé par nature) et suivi ventes − achats par code analytique.

Code : `src/lib/commandes.ts` (règles, pures), `src/services/commandes-admin.ts`, `src/lib/commandes-actions.ts`,
`src/app/(app)/purchases/`, `src/components/commandes/dialogues.tsx`. Tests : `tests/commandes.test.ts`,
`tests/commandes-flow.test.ts`.
