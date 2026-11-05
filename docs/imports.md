# Imports en masse

Menu **Imports** (administrateurs). Données importables : **clients et prospects**, **contrats**, **sites**,
**prestations et montants**, **paramétrage P1**, **contacts**, **compteurs**, **relevés de compteurs**. (Les articles de la bibliothèque de prix ont leur propre import : voir `bibliotheque-prix.md`.)

## Déroulé

1. Choisir le type de données et télécharger le **modèle** :
   - **CSV** (séparateur `;`, UTF-8 avec BOM, lisible tel quel par Excel) : en-têtes + une ligne d'exemple ;
   - **Excel** : onglet **Données** (en-têtes + exemple), onglet **Notice** (chaque colonne : obligatoire ou non,
     format, valeurs possibles, exemple, aide) et onglet **Listes** (valeurs du paramétrage : sociétés, agences,
     secteurs, typologies, types de compteur, activités, marchés, échéanciers, périodicités, taux de TVA).
2. Remplir le fichier (supprimer la ligne d'exemple) et le **déposer** (CSV ou XLSX).
3. **Aperçu**, ligne par ligne : création, mise à jour, inchangé ou erreur (avec le motif). Rien n'est écrit.
   Erreurs téléchargeables en CSV.
4. **Importer** : les lignes valides sont écrites, les lignes en erreur ignorées et rapportées. Chaque import est
   tracé (collection `imports`, écrite par le serveur seulement) et listé dans « Derniers imports ».

## Règles communes

- Le fichier est **relu et contrôlé par le serveur** avant toute écriture (l'aperçu du navigateur n'est pas pris
  pour acquis).
- **Une cellule vide conserve la valeur existante** : un fichier peut ne contenir que les colonnes à mettre à jour,
  et un même fichier peut être réimporté (lignes « inchangé »).
- Une colonne obligatoire absente ne bloque pas le fichier : elle empêche seulement les **créations**.
- Les imports **ne suppriment jamais rien**.
- Les codes **CLI / CTN / SIT / CPT** sont attribués par Zenergya (au-delà du plus grand code existant) : un code saisi
  sert uniquement à retrouver un élément existant.
- En-têtes reconnus sans tenir compte des accents, majuscules et astérisques ; colonnes inconnues ignorées.
- Formats : nombres à la française ou à l'anglaise, oui / non, SIRET contrôlé (clé de Luhn), code postal à 5
  chiffres (le 0 initial retiré par Excel est rétabli), email.
- Doublons dans le fichier (même code, même SIRET, même client + n° de site…) : seule la première ligne est retenue.
- 10 000 lignes au plus par import.

## Correspondance (mise à jour plutôt que création)

| Données | Élément existant retrouvé par | Doublon probable refusé (sans aucune clé) |
| --- | --- | --- |
| Clients et prospects | code client (CLI-…), sinon réf. externe, sinon SIRET | même nom et même code postal |
| Contrats | n° de contrat (CTN-…), sinon réf. externe | même client, même libellé, périodes qui se recouvrent |
| Sites | code site (SIT-…), sinon réf. externe, sinon client + n° de site | même client et même adresse + code postal |
| Prestations | réf. externe, sinon site + activité + date de début | — (recouvrement refusé, voir ci-dessous) |
| Contacts | client + email, sinon client + nom | — |
| Compteurs | code compteur (CPT-…), sinon réf. externe, sinon site + PDL/PCE | même site et même nom |
| Relevés de compteurs | compteur + date et heure (heure de Paris ; sans heure : minuit) | — |

Un doublon probable est refusé avec le code de l'élément semblable : indiquer ce code pour le mettre à jour, ou une
clé distincte (SIRET, n° de site, PDL/PCE, réf. externe) pour créer un autre élément.

### Réf. externe : reprendre une ancienne codification

Clients, contrats, sites et compteurs ont une **réf. externe** (code dans l'ancien système, TWIMM…), unique par type.
Elle retrouve l'élément au réimport et **désigne le parent dans les autres fichiers** : le client d'un contrat ou
d'un site (code CLI, SIRET ou réf. externe), le contrat d'un site (n° CTN ou réf. externe), le site d'un compteur
(code SIT ou réf. externe), le compteur d'un relevé (code CPT ou réf. externe). Une reprise complète se fait donc
sans connaître les codes Zenergya, dans l'ordre : **clients → contrats → sites → compteurs → prestations → relevés** (et contacts
après les clients). Chaque réimport met à jour, sans doublon.

Le « Code client » d'une fiche (CLI-…) est l'identifiant Zenergya : il n'est plus modifiable à l'écran (l'ancien
champ « Code externe » le modifiait). La réf. externe est un champ distinct.

### Liens entre les données

Références vérifiées : société (code ou nom), agence **de cette société**, secteur **de cette agence**, typologie,
activités, marché, échéancier, type de compteur (code ou libellé).

- **Contrat ↔ site** : le lien se fait **uniquement dans l'import des sites** (colonne Contrat) ; le contrat doit
  appartenir au client du site. Le site et le contrat sont tenus ensemble (`site.contractId` et la liste des sites
  du contrat). Un site déplacé est **retiré de son ancien contrat s'il est encore en cours** (sinon il y serait
  facturé deux fois) ; un contrat terminé le garde pour l'historique. Un site qui change de client doit changer de
  contrat dans la même ligne.
- **Contrat ↔ client** : un contrat qui a déjà des sites ou des factures ne change pas de client.
- **Noms recopiés** : renommer un client (import ou écran) met à jour son nom sur ses contrats (« client -
  libellé »), sites et compteurs ; renommer un site met à jour ses compteurs.
- **Relevé** : rattaché au contrat du site à sa création.

### Contrats

- Créés **validés** (trace : `validatedBy` = « import ») et au statut **Actif** sauf statut indiqué ; n° CTN attribué.
- Contrôles : fin après le début ; date de résiliation pour un contrat résilié ; activités, marché, échéancier et
  société connus ; cadre Chorus A9 / A12 avec le SIRET du valideur ; adresse de facturation électronique.
- Activités : codes séparés par « ; » (renseignées, elles remplacent la liste). Engagement juridique Chorus : ajouté
  à la liste du contrat s'il est nouveau, valable sur la durée du contrat.
- Changer les dates d'un contrat déjà facturé : avertissement (vérifier les périodes facturées).

### Prestations et montants facturés

Une prestation = **site × activité** sur le contrat du site, avec un **montant annuel HT**, une période de validité,
la TVA, la **périodicité** et le **terme** (à échoir ou échu) de facturation, et pour le P1 le compteur, le type P1 et
l'énergie (facturation : voir `facturation.md`).

- **Source unique de ce qui est facturé** : les montants du site (lus par la facturation) sont **calculés** à partir
  des prestations **en vigueur** (actives, date du jour dans leur période) : somme par activité. Un site qui a des
  prestations ne se saisit plus à la main (écrans Sites et Contrat : montants en lecture seule) ; un site sans
  prestation garde ses montants saisis (transition).
- Recalcul à chaque écriture d'une prestation (écran, import, API) et **chaque jour** (une prestation qui commence ou
  se termine change les montants) : planifier `POST /api/sites/amounts` (voir `securite.md`).
- Contrôles : site rattaché à un contrat ; activité **parmi celles du contrat** (sinon elle ne serait pas facturée) ;
  pas de **recouvrement** entre deux prestations actives du même site et de la même activité (facturées deux fois) ;
  compteur du même site, et seulement pour le P1 ; fin après le début ; périodicité (mensuel, trimestriel, semestriel,
  annuel), terme (à échoir, échu) et TVA connus. Avertissement si
  la période sort de celle du contrat.
- Changement de prix daté : terminer la prestation la veille et en créer une nouvelle à partir de la date d'effet ;
  l'historique des prix est conservé.
- Révision : « Règle de révision » (code), « Indices de base » (`CODE=valeur@AAAA-MM`, séparés par « ; », un par
  indice de la règle), « Révision tous les (mois) », « Date anniversaire de révision » (JJ/MM), « Révisé dès le
  début ». Voir `facturation.md`.
- Fin vide à la création : fin du contrat. Un site déplacé vers un contrat sans prestation n'a plus de montant (les
  prestations de l'ancien contrat ne se facturent pas sur le nouveau).
- **Bascule** (une fois, après le déploiement) : `npm run montants:prestations` affiche site par site l'écart entre
  les montants saisis et ceux des prestations ; vérifier, puis `npm run montants:prestations -- --apply`.

Relevés : dates `AAAA-MM-JJ` ou `JJ/MM/AAAA` (heure `HH:MM` facultative ; les dates des cellules Excel sont lues
telles quelles), index positif ou nul. Refusés : date future, même compteur et même instant sur deux lignes, index
modifié d'un relevé repris dans un intéressement ou une régularisation. Signalés sans bloquer : index en baisse par
rapport au relevé précédent (ou supérieur au suivant), compteur hors service. Détails : `api-externe.md`.

### Paramétrage P1 (versions datées)

Une ligne = une version : élément (code SIT, CPT ou CTN, ou réf. externe), poste (pour les paramètres de poste,
créé s'il n'existe pas), paramètre (liste de la notice), valeur, date d'effet (vide : valeur d'origine), motif,
pièce. Formule de NC : `CPT-00012 + CPT-00013 - CPT-00020` (compteurs du site). Une version identique déjà saisie
est inchangée ; une autre valeur à la même date est refusée (la retirer à l'écran, avec son motif). Voir
`parametrage-p1.md`.

## Fichiers Excel

La lecture des fichiers Excel exige une version corrigée de la librairie SheetJS (`xlsx` ≥ 0.19.3) : la 0.18.5
publiée sur npm a des failles à la lecture de fichiers fournis par l'utilisateur (CVE-2023-30533,
CVE-2024-22363). Avec une version non corrigée, le dépôt d'un fichier Excel est refusé (importer en CSV) ; les
modèles Excel restent téléchargeables. Version corrigée :
`npm install --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.

## À venir

Facturation lue directement sur les prestations (TVA et périodicité par prestation) ; vérification en masse des SIRET importés dans le répertoire des entreprises.

## Vérifier les liens existants

Les versions précédentes pouvaient laisser un site dans la liste de son ancien contrat (facturé deux fois) ou
recréer les sites d'un contrat corrigé (compteurs orphelins). À lancer une fois après le déploiement :
`npm run liens:verifier` (simulation : anomalies et réparations), puis `npm run liens:verifier -- --apply`.
Les anomalies qui demandent une décision (compteur rattaché à un site supprimé…) sont seulement listées.
