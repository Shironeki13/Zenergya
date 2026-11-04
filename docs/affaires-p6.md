# Affaires P6 : facturation à l'avancement

Menu **Travaux → Affaires (P6)**. Une affaire se crée depuis un **devis accepté** de type P6 (carte « Facturation à
l'avancement » du devis).

## Création

- Les lignes chiffrées du devis (options exclues) forment le **marché** : quantités, prix et TVA **figés**, rattachés
  à leur titre. Code `{CODE}-AFF{AAAA}-{NNNN}`.
- **Retenue de garantie** : % du TTC de chaque situation (5 % en général, 10 % au plus), ou **caution bancaire** en
  remplacement (aucune retenue).
- Le devis est rattaché à l'affaire et ne se facture plus directement (ni acompte, ni totalité). Un devis déjà
  facturé directement ne peut pas devenir une affaire.

## Situations

Chaque mois, une **situation** porte l'avancement **cumulé** de chaque ligne (en % du marché) :

| | Calcul |
| --- | --- |
| Cumul d'une ligne | montant HT du marché × % (100 % = montant exact) |
| Montant de la situation | cumul − cumul de la dernière situation facturée |
| TVA | par **différence des cumuls**, taux par taux : à 100 %, la somme des situations égale exactement le devis |
| Retenue de garantie | % du TTC de la situation, déduite du **net à payer** (la base HT et la TVA de la facture restent entières) |

- Une seule situation en préparation à la fois (enregistrable, supprimable). L'avancement cumulé ne baisse pas :
  une correction passe par un **avoir**.
- **Facturer la situation** : contrôles, numéro légal (série des factures), facture « FACTURE DE SITUATION N° k »
  (affaire, mois des travaux, avancement et cumuls par ligne, TVA par taux, retenue, net à payer), PDF archivé,
  facturation électronique (bon de commande du devis comme engagement juridique Chorus), dans une transaction.
- **Ce qui est déjà facturé se lit dans les factures non annulées** (état cumulé enregistré sur chaque facture) :
  une situation annulée par avoir ne compte plus, l'avancement se refacture dans la situation suivante.

## Jalons

**Réception des travaux** (date), **libération de la retenue** (après la réception, à la fin du délai de garantie),
**clôture** (plus aucune situation).

## Sécurité

`projects` et `projectSituations` ne sont écrits que par le serveur (`src/services/projects-admin.ts`, actions
`src/lib/projects/actions.ts`, session requise).

## Limites

- Marchés publics de travaux : le dépôt Chorus des situations relève normalement des cadres « travaux » (projet de
  décompte mensuel validé par le maître d'œuvre, A4…), pas encore gérés ; le cadre du contrat (A1 par défaut) est
  utilisé.
- Pas encore d'avance forfaitaire (marchés publics) ni de révision de prix des situations.
- Avenants au marché : à venir (aujourd'hui, une nouvelle affaire).
