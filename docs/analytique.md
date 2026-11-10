# Analytique

Un code analytique par ligne vendue (et, à terme, achetée), pour suivre les ventes puis les marges par société, agence,
secteur, client, contrat, activité et site.

## Le code

Pyramide client → contrat → prestation, lisible de gauche à droite :

```
société - agence - secteur - client       - contrat     - activité
ZEN     - LYO    - LN      - CLI00012     - CTN00034    - P2
└────────── client ───────────────┘
└────────────────── contrat ──────────────────────┘
└──────────────────────── prestation ─────────────────────────┘
```

| Segment | Source |
|---|---|
| Société | code de la société émettrice du contrat (sinon celle du client) |
| Agence, secteur | **code court** (2 à 8 lettres ou chiffres) de l'agence et du secteur du client : Paramétrage › Agences, Secteurs (obligatoire, unique dans la société ou l'agence, proposé d'après le nom) |
| Client, contrat | codes Zenergya (`CLI-00012`, `CTN-00034`), immuables |
| Activité | code de l'activité de la prestation (`P1`, `P2`…) |

Le **site** n'est pas dans le code : une prestation a un seul code pour tous ses sites ; le site est un axe de chaque
ligne de facture, pour détailler quand il le faut.

## Code généré, code externe

- **Généré** par Zenergya, puis **figé** (enregistré sur le client, le contrat, la prestation, avec les axes du contrat)
  à la première facture émise : un changement d'agence, de secteur ou de société ne le modifie pas tout seul.
- **Externe** (outil comptable, champ « Analytique externe ») à n'importe quel niveau : il devient le code effectif du
  niveau ; les niveaux en dessous en héritent en y ajoutant leur segment (`V080912-1` → `V080912-1-P2`), sauf s'ils
  ont leur propre code externe. Saisi sur la fiche (carte Analytique) ou importé (colonne « Analytique externe » des
  imports Clients, Contrats, Prestations). Vide : retour au code généré.
- La carte **Analytique** des fiches client et contrat affiche, par niveau, le code effectif et son origine (généré,
  figé, externe, hérité), et ce qui manque quand un code n'est pas générable.
- **Réaffecter** (administrateur, fiche du contrat) : régénère le code du contrat et de ses prestations (et, au choix,
  du client) à partir du référentiel actuel, avec un motif ; l'ancien code reste dans l'historique du contrat.

## Sur les factures

Chaque ligne de facture et d'avoir garde, à l'émission (`lineItems[].analytique`) : le code effectif, le code généré et
le code externe quand ils existent, et les axes (codes et identifiants : société, agence, secteur, client, contrat,
activité, site). L'historique ne bouge donc pas : un code modifié ou réaffecté ne vaut que pour les lignes suivantes.
Un proforma porte un code calculé ; il est figé à sa conversion en facture. Sans code générable ni externe, la ligne
n'a pas d'analytique (la facturation n'est pas bloquée) et apparaît en « non affecté » dans le suivi.

## Suivi

Facturation › **Suivi analytique** : ventes HT facturées sur une période (factures − avoirs), totalisées jusqu'à l'axe
choisi (société › agence › secteur › client › contrat › activité › site), export CSV.

## Reprise de l'existant

`npm run analytique:reprise` (simulation), puis `-- --apply` : fige les codes des contrats et pose l'analytique sur les
lignes des factures et avoirs déjà émis (au code d'aujourd'hui), sans toucher aux montants, numéros ni PDF archivés.
Liste les contrats sans code générable (code d'agence ou de secteur manquant) à compléter d'abord.

## Travaux : l'affaire

Pour les travaux, l'objet analytique est l'**affaire** (une par devis accepté, P5 comme P6), pas la prestation :

```
société - agence - secteur - client     - affaire
ZEN     - LYO    - LN      - CLI00012   - AFF20260007
```

- Les quatre premiers segments sont ceux des contrats : ventes (et marges) se totalisent ensemble par société, agence,
  secteur et client. Dans le suivi, l'affaire tient la place du contrat (axe « Contrat ou affaire ») ; l'activité est
  `P5` ou `P6` ; si les travaux dépendent d'un contrat, il est gardé comme axe (`contratLie`).
- **P5** : l'affaire est créée à l'acceptation du devis ; il se facture directement (acompte, solde, totalité).
  **P6** : l'affaire se crée depuis le devis accepté quand on choisit la facturation par situations (retenue de
  garantie).
- **Devis complémentaire** : à l'acceptation (ou depuis le devis accepté), « rattacher à une affaire existante » du
  même client : même code, budget cumulé ; ses lignes rejoignent le marché (à 0 % d'avancement pour une affaire par
  situations).
- **Budget prévu** de l'affaire : somme de ses devis — prix de vente, déboursé par nature (fournitures, main-d'œuvre,
  sous-traitance, divers ; les ouvrages sont ventilés par nature de leurs composants), heures, marge prévue.
- Le code est **figé à la création** de l'affaire (avec ses axes) ; un **code externe** peut le remplacer (fiche de
  l'affaire). Chaque ligne des factures de l'affaire (acompte, solde, situation) le porte.
- Reprise : `npm run affaires:reprise` (simulation), puis `-- --apply` : crée l'affaire des devis P5 acceptés qui n'en
  ont pas, complète les affaires antérieures (devis, budget, analytique) et pose l'analytique sur leurs factures.

Code : `src/lib/projects/affaire.ts`, `src/services/projects-admin.ts`, `src/components/projects/affaire-synthese.tsx`,
`src/components/quotes/project-panel.tsx`.

## À venir

Commandes d'achat (circuit de validation à seuils), factures fournisseurs et heures portant le même code : par affaire,
prévu / engagé / réel / facturé par nature ; marge = ventes − achats, par code ou par axe.

Code : `src/lib/analytique.ts` (logique pure), `src/services/analytique-admin.ts`, `src/lib/analytique-actions.ts`,
`src/components/analytique/analytique-card.tsx`, `src/app/(app)/billing/analytique/page.tsx`.
