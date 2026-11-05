# Facturation : numérotation, avoirs et arrondis

## Facturation des contrats (montant, TVA, échéance)

Calcul : `src/lib/billing/contract-billing.ts` (partagé par le serveur et l'aperçu de la facturation groupée) ;
préparation : `src/services/contract-billing-admin.ts`.

- **Période** : selon l'échéancier du contrat (mensuel, trimestriel, semestriel, annuel), à la suite de la
  dernière période facturée (factures émises et proformas en attente ; les factures annulées par avoir ne comptent
  pas). Un échéancier inconnu ou absent bloque la facture (pas d'annuel supposé).
- **Lignes** : un site piloté par ses prestations est facturé **prestation par prestation** (prestations actives
  de l'activité du contrat) ; un site sans prestation, sur ses montants saisis. Montant de la période pleine =
  montant annuel × mois / 12.
- **Prorata au jour près** : une période raccourcie (fin du contrat, prestation qui commence ou se termine en cours
  de période) est facturée au prorata des jours couverts sur les jours de la période pleine, indiqué sur la ligne
  (« prorata 61/92 j »).
- **TVA par ligne** : celle de la prestation, sinon la **TVA par défaut de l'activité** (paramétrage). Aucun taux
  n'est supposé : une TVA manquante bloque la facture et liste les lignes concernées. Totaux **par taux**
  (ventilation de TVA sur la facture et le PDF).
- **Échéance** : conditions de paiement du contrat, sinon du client (délai en jours, éventuellement fin de mois) ;
  sans condition : 30 jours (délai légal par défaut). Le paramétrage refuse un délai au-delà du maximum légal
  (60 jours, ou 45 jours fin de mois). Un proforma converti en facture a son échéance recalculée à sa date
  d'émission.
- **Facturation groupée** : aperçu calculé comme la facture (HT et TVA), contrats en erreur signalés et non
  sélectionnables ; les périodes d'un même contrat s'émettent dans l'ordre, chacune vérifiant qu'elle est bien la
  suivante (plus de double facturation d'une même période).

À paramétrer avant de facturer : **TVA par défaut de chaque activité** (Paramétrage → Activités) et **délai de
chaque condition de paiement** (Paramétrage → Règlements) ; conditions de paiement sur les clients (fiche client,
import) ou les contrats (import, API).

Pas encore géré : révision des prix (indices), terme à échoir / échu, facturation du P1 sur consommation
(acomptes, régularisation, intéressement).

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
