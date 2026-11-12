# Heures de main-d'œuvre

Les techniciens saisissent leurs heures, par jour, sur une **affaire de travaux** ou sur un **contrat et une activité**.
Chaque saisie porte le code analytique de son affectation (voir `analytique.md`) et un coût : c'est le **réel de
main-d'œuvre**, à comparer aux heures prévues des devis de l'affaire.

Menu **Travaux › Heures** (`/timesheets`).

## Saisie

- Date, affectation, durée (au **quart d'heure**), commentaire. Pas d'heures à l'avance ; 24 h au plus par jour et par
  personne.
- **Qui saisit pour qui** : chacun pour soi ; un **responsable (N+1)** pour son équipe directe ; un **administrateur**
  pour tous.
- Une affaire **clôturée** ne reçoit plus d'heures, et les siennes ne se modifient plus.
- Onglets « Mes heures » / « Toutes », période, recherche, filtres par technicien et par affectation, export CSV.

## Validation par le responsable

Les heures ne comptent dans les affaires qu'une fois **validées**.

| Qui enregistre | Statut |
|---|---|
| Le technicien, pour lui-même (saisie ou import) | **À valider** |
| Son responsable (N+1) ou un administrateur, pour lui | **Validée** d'office |

- **Qui valide** : le responsable (N+1) du technicien ; un administrateur pour tous, et pour qui n'a pas de
  responsable renseigné. **Personne ne valide ses propres heures.**
- **Onglet « À valider »** : les saisies en attente de mon équipe ; sélection, puis « Valider » ou « Refuser » (motif
  obligatoire), en lot.
- **Refus** : le technicien voit le motif, corrige sa saisie, qui repart en validation.
- **Une fois validée**, une saisie ne se modifie plus ni ne se supprime par le technicien : son responsable (ou un
  administrateur) la corrige, et elle reste validée.
- **Dans les affaires** : seules les heures validées entrent dans l'engagé et le réel ; les heures à valider sont
  affichées à part ; les heures refusées ne comptent pas. Même règle pour le suivi analytique.
- Les heures saisies avant la mise en place de la validation sont considérées comme validées.

## Valorisation

- **Coût horaire** : celui de l'utilisateur (Utilisateurs › « Coût horaire interne »), sinon celui de la société
  (Paramétrage › société › « Coût horaire MO interne », le même que celui des devis). S'il n'y en a aucun, la saisie
  est refusée avec un message qui dit où le renseigner.
- Le coût horaire et le code analytique sont **figés à la saisie** : changer le coût horaire ensuite ne modifie pas les
  heures déjà saisies. Si l'affectation d'une saisie est changée, elle est revalorisée au coût en vigueur.

## Import

Pour les heures saisies dans un autre outil : bouton « Importer des heures » (responsables et administrateurs), fichier
Excel (.xlsx) ou CSV ; un modèle se télécharge depuis le dialogue.

| Colonne | |
|---|---|
| Date * | `AAAA-MM-JJ` ou `JJ/MM/AAAA` |
| Technicien (email) * | email de l'utilisateur Zenergya |
| Affaire | code de l'affaire (`ZEN-AFF2026-0003`) ; sinon Contrat et Activité |
| Contrat, Activité | numéro du contrat (`CTN-00001`) et code de l'activité (`P2`) |
| Heures * | au quart d'heure (`7,5`) |
| Commentaire | facultatif |

- Le fichier est d'abord **simulé** : chaque ligne est « à créer », « déjà saisie » ou en erreur (utilisateur, affaire
  ou contrat inconnu, activité absente du contrat, affaire clôturée, plus de 24 h dans la journée, technicien hors de
  votre équipe…).
- **Rien n'est importé tant qu'une ligne est en erreur.**
- Une ligne déjà présente (même technicien, jour, affectation et durée) est ignorée : le même fichier se réimporte sans
  doublon.

Voir aussi `rentabilite.md` : prévu / engagé / réel / facturé par affaire.

Code : `src/lib/heures.ts` (règles, pures), `src/services/heures-admin.ts`, `src/lib/heures-actions.ts`,
`src/app/(app)/timesheets/page.tsx`, `src/components/heures/import-dialog.tsx`. Tests : `tests/heures.test.ts`,
`tests/heures-flow.test.ts`.
