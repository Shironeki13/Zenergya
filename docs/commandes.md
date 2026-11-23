# Commandes d'achat

Une commande engage une dépense auprès d'un fournisseur. Chaque **ligne** est affectée à une **affaire de travaux** ou à
un **contrat (et une activité)** : elle porte donc le même code analytique que les ventes (voir `analytique.md`), ce qui
permettra de comparer prévu, engagé, réel et facturé.

Menu **Achats › Commandes** (`/purchases`).

## Circuit de validation

Le circuit dépend du total HT de la commande, du **demandeur** et des **plafonds de sa hiérarchie** :

1. **Autovalidation** : jusqu'à son montant d'autovalidation, le demandeur valide lui-même (la commande est validée à
   la soumission).
2. **Au-delà**, son responsable (**N+1**) valide **toujours**. Si le plafond de validation du N+1 ne couvre pas le
   total, la commande monte ensuite au **N+2**, puis au N+3…, jusqu'à un valideur dont le plafond suffit.
3. **Achats** : au-delà du seuil global, un utilisateur dont le rôle a le droit **Achats** valide en dernier, quel que
   soit le reste du circuit (même pour une commande que le demandeur valide lui-même).

Exemple — technicien (autovalidation 500 €), responsable (plafond 5 000 €), directeur (plafond 100 000 €) :

| Total HT | Circuit |
|---|---|
| 400 € | autovalidée |
| 3 000 € | N+1 |
| 8 000 € | N+1, puis N+2 |
| 45 000 € | N+1, puis N+2, puis achats |

**Où se règlent les montants**

- **Par utilisateur** (Utilisateurs › fiche) : « Commandes : autovalidation jusqu'à » et « Commandes : valide jusqu'à »,
  avec son **responsable (N+1)**. Les deux montants sont facultatifs ; zéro est une vraie valeur (aucune autovalidation,
  ou un valideur qui fait toujours monter la commande après l'avoir validée).
- **Par société** (bouton « Seuils », administrateur) : les **valeurs par défaut** pour qui n'a pas ses propres montants
  (500 € et 5 000 € HT d'origine), et le **seuil global des achats** (10 000 € HT). Seules les exceptions sont donc à
  renseigner sur les fiches.

**Règles**

- Si le responsable du demandeur manque, ou si **personne en haut de la hiérarchie n'a un plafond suffisant**, la
  soumission est refusée avec un message qui dit quel plafond relever ; la commande reste en brouillon.
- Les étapes se suivent dans l'ordre. Un **refus** (motif obligatoire) renvoie la commande au demandeur, qui la corrige
  et la soumet à nouveau : le circuit est recalculé.
- Personne ne valide **sa propre** commande. Un **administrateur** peut valider une étape à la place du valideur
  absent : la décision est marquée « en secours ».
- Le circuit, les plafonds des valideurs et les seuils de la société sont **figés sur la commande** à la soumission :
  les changer ensuite ne modifie pas les commandes en cours.

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

## Import

Pour les commandes saisies dans un autre outil : bouton « Importer » de la liste, fichier Excel (.xlsx) ou CSV ; un
modèle se télécharge depuis le dialogue. **Une ligne de fichier par ligne de commande** ; les lignes qui portent la même
**Référence** forment une commande (les lignes suivantes peuvent laisser date, fournisseur, objet et demandeur vides).

| Colonne | |
|---|---|
| Référence * | numéro de la commande dans l'outil d'origine |
| Date *, Fournisseur *, Objet * | fournisseur : code (`FRN-00001`) ou nom exact ; il doit exister dans Fournisseurs |
| Demandeur (email) | utilisateur Zenergya ; vide : celui qui importe |
| État | `brouillon` (défaut) ou `validée` |
| Désignation *, Nature *, Quantité *, Prix unitaire HT * | nature : Fournitures, Sous-traitance, Divers |
| Affaire, ou Contrat et Activité | affectation analytique de la ligne |
| Livraison souhaitée | facultative |

- **État « brouillon »** : la commande est créée au nom de son demandeur, qui la soumet ; elle suit le **circuit de
  validation** normal.
- **État « validée »** : la commande a été validée hors Zenergya ; elle entre validée, **sans circuit**, avec un numéro
  et son analytique figée, et elle est marquée « importée » (avec le nom de celui qui l'a importée). Réservé aux
  **achats** et aux **administrateurs**, comme l'import pour un autre demandeur.
- Le fichier est d'abord **simulé** ; **rien n'est importé tant qu'une commande est en erreur** (fournisseur, demandeur,
  affaire ou contrat inconnu, affaire clôturée, ligne incomplète…).
- Une **référence déjà importée** dans la société est ignorée : le même fichier se réimporte sans doublon. La référence
  d'origine reste visible et recherchable dans la liste.

Voir aussi `rentabilite.md` : prévu / engagé / réel / facturé par affaire.

Code : `src/lib/commandes.ts` (règles, pures), `src/services/commandes-admin.ts`, `src/lib/commandes-actions.ts`,
`src/lib/commandes-import.ts`, `src/app/(app)/purchases/`, `src/components/commandes/`. Tests : `tests/commandes.test.ts`,
`tests/commandes-flow.test.ts`, `tests/commandes-import.test.ts`, `tests/commandes-import-flow.test.ts`.
