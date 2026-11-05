# Facturation : numérotation, avoirs et arrondis

## Facturation des contrats : échéancier des prestations

Calcul : `src/lib/billing/contract-billing.ts` (partagé par le serveur, la facturation groupée et le calendrier de
la fiche site) ; préparation : `src/services/contract-billing-admin.ts`.

- **Éléments facturés** : chaque prestation active d'un site piloté par ses prestations ; pour un site sans
  prestation, chaque montant saisi (site × activité).
- **Périodicité** (mensuel, trimestriel, semestriel, annuel) : celle de la prestation, sinon celle du site, sinon
  l'échéancier du contrat. Les périodes sont **calées sur le début du contrat** : toutes les prestations d'un
  contrat partagent les mêmes bornes. Une périodicité inconnue ou absente bloque (pas d'annuel supposé).
- **Terme** : **à échoir** (facturable dès le premier jour de la période) ou **échu** (facturable le lendemain de
  sa fin) ; celui de la prestation, sinon du site, sinon à échoir (signalé dans la facturation groupée). Un terme
  illisible bloque.
- **Une facture par contrat** regroupe toutes les échéances facturables à la date demandée (date de facture, ou
  « facturer jusqu'au » en facturation groupée, ce qui permet d'anticiper un terme à échoir) : rattrapage compris,
  une ligne par échéance avec sa période et son terme.
- **Prorata au jour près** : une échéance raccourcie (début ou fin de prestation ou de contrat en cours de période)
  est facturée au prorata des jours sur la période pleine (« prorata 17/31 j »).
- **Déjà facturé** : chaque ligne porte l'élément facturé et sa période ; les factures et proformas non annulés
  comptent, les factures annulées par avoir ne comptent pas (leurs échéances redeviennent facturables). Les
  factures antérieures à l'échéancier (sans ce détail) comptent par site et activité jusqu'à leur fin de période.
- **Pas de double facturation** : la facture n'est enregistrée que si le contrat n'a pas été facturé depuis la
  préparation (version de facturation du contrat vérifiée dans la transaction qui attribue le numéro).
- **TVA par ligne** : celle de la prestation, sinon la **TVA par défaut de l'activité** ; aucun taux supposé (une
  TVA manquante bloque la facture et liste les lignes concernées). Totaux et ventilation **par taux**.
- **Échéance de paiement** : conditions du contrat, sinon du client (délai en jours, éventuellement fin de mois) ;
  sans condition : 30 jours. Plafonds légaux contrôlés au paramétrage (60 jours, ou 45 jours fin de mois). Un
  proforma converti a son échéance recalculée à sa date d'émission.
- **Facturation groupée** : un aperçu par contrat (nombre d'échéances, périodes, HT, TVA, avertissements) calculé
  comme la facture ; contrats en erreur signalés et non sélectionnables.
- **Fiche site** : le calendrier de facturation d'une prestation montre ses échéances (période, date à partir de
  laquelle elle est facturable, montant HT) et la facture qui couvre chacune.

À paramétrer avant de facturer : TVA par défaut de chaque activité, délai de chaque condition de paiement, et sur
les prestations leur périodicité et leur terme (fiche site ou import des prestations, colonnes « Périodicité » et
« Terme »).

### Révision des prix

Calcul : `src/lib/billing/revision.ts`.

- **Source unique : la prestation** (règle de révision, valeurs de base I0 avec leur mois, calendrier). Sans règle :
  prix ferme. Les révisions saisies sur un site sans prestation ne sont pas appliquées (signalé).
- **Calendrier** : révision tous les 12 mois (ou 6, 3, 1) à la date anniversaire de la prestation (JJ/MM ; par
  défaut le jour du début du contrat). Le prix de base s'applique jusqu'à la première révision qui suit le début du
  contrat, sauf « révisé dès le début ». Une échéance qui chevauche une date de révision est coupée en deux lignes.
- **Indices datés** : à une révision du mois M, chaque indice vaut la moyenne des « Moyenne » mois consécutifs qui
  finissent « Décalage » mois avant M (règle de révision, Paramétrage : par défaut 3 mois finissant le mois
  précédent). Les indices calculés sont évalués par leur formule. Un mois manquant ou une valeur de base absente
  bloque la facture (aucun coefficient supposé).
- **Coefficient** : prix ferme = 1 ; Σ coeff × In/I0 ; a + b × Σ coeff × In/I0 ; arrondi à « Décimales » (4 par
  défaut).
- **Facture** : chaque ligne révisée porte le montant avant révision, le coefficient, la date de révision et les
  indices utilisés (mois, valeur, base), imprimés dans son libellé.
- **Figé une fois facturé** : le coefficient d'une révision déjà facturée est réutilisé pour les échéances suivantes
  de la même révision ; une correction d'indice publiée après coup ne change ni le passé ni la suite de la période.

### Acomptes P1 et régularisation

Calcul : `src/lib/billing/contract-billing.ts` (`acompteP1`), `src/lib/billing/p1-regularisation.ts` ; écran
Facturation → Régularisation P1.

- **Acompte P1** : mode de facturation d'une prestation P1 (fiche site, « Facturation du P1 »). À chaque échéance
  (périodicité et terme de la prestation), montant = pour chaque mois couvert (au prorata de ses jours) quantité
  annuelle × part du mois × prix révisé P1 du mois (indice reporté : prix provisoire). Par usage :
  - **chauffage** : quantité « Quantité annuelle des acomptes » du site, sinon somme des cibles NB de ses postes
    (MWh) ; « Répartition des acomptes P1 » du contrat (ex. saison de chauffe) ; prix de base du site × formule P1
    chauffage ;
  - **ECS** (prestation P1 de type ECS) : « Volume annuel des acomptes ECS » du site (m³) ; « Répartition des
    acomptes ECS » du contrat (en général linéaire) ; prix de base ECS du site × formule P1 ECS.
  Les autres types P1 (eau froide, autre) ne se facturent pas en acompte. Le montant annuel de la prestation est ignoré, la révision des prestations ne
  s'applique pas (le prix est déjà révisé). Le détail mensuel est conservé sur la ligne. Facturation globale non
  prise en charge pour les acomptes.
- **Réel du moteur** : import « Réel P1 du moteur » (site, mois, montant P1 HT, usage), collection `p1Reel` écrite
  par le serveur. Usage vide : total du mois (`p1_facturation_site`) ; « chauffage » ou « ECS » : réel par usage
  (`p1_facturation_chauffage`, `p1_facturation_ecs`). Un mois déjà régularisé ne change plus.
- **Régularisation** (contrat, période) : par site, réel − acomptes facturés (factures non annulées) — au total (une
  ligne, possible seulement si les acomptes chauffage et ECS ont la même TVA) ou par usage (une ligne par usage, à
  sa TVA ; mélanger total et usages sur une période est refusé) ; plus les
  intéressements calculés dont la saison finit dans la période. Lignes positives : une facture ; négatives : un
  **avoir de régularisation** qui n'annule pas les factures d'acompte. Un mois facturé en acompte sans réel bloque ;
  un mois déjà régularisé ne se régularise pas deux fois ; les mois régularisés ne sont plus facturés en acompte.
- L'aperçu de la facturation groupée est calculé au serveur, exactement comme la facture (acomptes compris).

## Numérotation (factures et avoirs)

Exigence légale (CGI, annexe II, art. 242 nonies A) : numéros uniques, chronologiques et continus, par société émettrice.

| Document | Format | Série |
| --- | --- | --- |
| Facture | `{CODE}-{AAMM}-{NNNN}` (ex. `ACME-2610-0001`) | par société et par mois |
| Avoir | `{CODE}-AV{AAAA}-{NNNN}` (ex. `ACME-AV2026-0001`) | par société et par année |

`{CODE}` est le code de la société émettrice (*Paramétrage → Sociétés*). Il est obligatoire pour émettre une facture.

Fonctionnement (`src/services/firestore-admin.ts`) :

- le numéro est attribué **dans la même transaction Firestore** que l'écriture de la facture ou de l'avoir.
  Si l'écriture échoue, le numéro n'est pas consommé : pas de trou possible ;
- un compteur par série dans la collection `counters` (`invoice_{préfixe}`, `creditNote_{préfixe}`) ;
- à l'ouverture d'une nouvelle série, le compteur repart du plus grand numéro déjà émis avec ce préfixe
  (reprise des factures émises avec l'ancien compteur global, sans doublon) ;
- un proforma ne consomme pas de numéro ; *Factures → Convertir en facture* lui en attribue un, daté du jour.

Société émettrice : celle du contrat, sinon celle du client, sinon la seule société configurée.
Elle est enregistrée sur la facture (`companyId`) et utilisée pour l'affichage et le PDF.

> Les avoirs émis avant ce changement gardent leur ancien numéro (`AV{AAAA}-{NNNN}`).
> Les factures émises avant ce changement par plusieurs sociétés partageaient un compteur mensuel unique :
> leurs séries peuvent présenter des sauts, sans doublon.

## Annulation : avoir, jamais de suppression

- Une facture émise ne peut pas être supprimée (règles Firestore, y compris pour un administrateur).
- Pour l'annuler : *Factures* → sélectionner → *Générer un avoir*. L'avoir et le passage des factures à « annulée »
  sont écrits dans la même transaction ; une facture déjà annulée ne peut pas recevoir un second avoir.
- La période d'une facture annulée peut être refacturée.
- Seuls les proformas peuvent être supprimés.
- Depuis le navigateur, seul le statut d'encaissement d'une facture peut être modifié (due ↔ en retard ↔ payée).

## Archivage des PDF (copie conforme)

Chaque facture émise et chaque avoir sont rendus en PDF **une seule fois, à l'émission**
(`src/services/document-archive.ts`, modèle `src/lib/pdf/accounting-document.tsx`), puis stockés dans Cloud Storage :

```
archives/{société}/invoices/{année}/{numéro}.pdf
archives/{société}/credit-notes/{année}/{numéro}.pdf
```

- **Jamais réécrit** : l'écriture est conditionnelle (le fichier ne doit pas exister).
- **Empreinte SHA-256** enregistrée sur la facture / l'avoir (`pdf.sha256`, avec `pdf.path`, `pdf.size`, `pdf.generatedAt`)
  et **vérifiée à chaque téléchargement** : un fichier modifié après émission est refusé avec une erreur explicite.
- **Accès** : uniquement via `/api/documents/invoices/{id}` ou `/api/documents/credit-notes/{id}`, après contrôle de la session.
  Pas de lien public permanent. Les règles Storage interdisent tout accès au dossier `archives/` depuis le navigateur.
- **Proformas** : PDF généré à la demande, jamais archivé (sans valeur comptable).
- **Rattrapage** : si l'archivage échoue à l'émission, ou pour les factures émises avant cette fonctionnalité,
  le PDF est archivé au premier téléchargement.

> Les factures émises avant cette fonctionnalité sont archivées à leur premier téléchargement, avec les informations
> société / client **du moment du téléchargement**. Pour figer tout l'historique dès maintenant, ouvrez leur PDF une fois
> (un script d'archivage en masse peut être ajouté si besoin).

Mentions portées par le PDF : identité, SIRET et TVA intracommunautaire de la société émettrice ; nom, adresse et SIRET du client ;
numéro ; date d'émission ; échéance ; période ; désignation, quantité, prix unitaire HT ; total HT, taux et montant de TVA, total TTC ;
pénalités de retard, indemnité forfaitaire de recouvrement de 40 €, absence d'escompte ; pour un avoir, factures d'origine et motif.
**À faire valider par votre expert-comptable**, notamment le taux des pénalités de retard (repris de l'ancien modèle : 1,5 % par mois)
et, le cas échéant, la mention « option pour le paiement de la TVA d'après les débits ».

## Arrondis

`src/lib/money.ts` : chaque ligne est arrondie au centime, le HT est la somme des lignes arrondies,
la TVA est calculée sur ce HT puis arrondie, le TTC est HT + TVA.

## Tests

- `npm test` : arrondis.
- `npm run test:billing` : numérotation, conversion de proforma, avoirs, archivage des PDF (émulateurs Firestore et Storage, Java requis).
- `npm run test:rules` : règles Firestore.
