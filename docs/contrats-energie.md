# Contrats d'énergie et factures des fournisseurs

Menu Achats › Contrats d'énergie. Réservé aux administrateurs et aux utilisateurs du module Achats.

## Ce que le logiciel tient

- **Points de livraison** (PDL / PCE), rattachés au site facturé qu'ils alimentent, avec leurs **périodes de
  fourniture** (fournisseur, contrat, dates, prix). L'état et la couverture se calculent des dates.
- **Import** de la feuille de suivi (onglet « SITES P1 »), rejouable sans doublon.
- **Rappel** par mail des fournitures à renouveler (voir `notifications.md`).

Ces données sont dans Firestore (collection `pointsLivraison`).

## Factures des fournisseurs : lues dans BigQuery

Les factures des fournisseurs d'énergie ne sont pas recopiées dans le logiciel : elles sont lues, en lecture seule,
dans les vues BigQuery alimentées par les flux (Esker) et par l'historique.

| Réglage (variable d'environnement) | Rôle | Valeur par défaut |
|---|---|---|
| `ENERGIE_BQ_PROJET` | Projet où s'exécutent les requêtes. **Sans lui, la lecture est désactivée.** | aucune |
| `ENERGIE_BQ_MOIS` | Profondeur lue, en mois | 24 |
| `ENERGIE_BQ_VUE_GAZ_ESKER` | Vue gaz des flux | `fr-sde-ved-venf-dev.FrnEnergies_501_dataviz.vcli_factures_gaz` |
| `ENERGIE_BQ_VUE_ELEC_ESKER` | Vue électricité des flux | `…vcli_factures_elec` |
| `ENERGIE_BQ_VUE_RCU_ESKER` | Vue réseau de chaleur des flux | `…vcli_factures_rcu` |
| `ENERGIE_BQ_VUE_GAZ_HISTORIQUE` | Vue gaz historique | `gbl-ist-vigs-energie.facturesEnergie_503_dataviz.vcli_facturesGazVENF` |
| `ENERGIE_BQ_VUE_ELEC_HISTORIQUE` | Vue électricité historique | `…vcli_facturesElecVENF` |

Une variable de vue laissée vide retire cette vue de la lecture.

**Droits à accorder au compte de service de l'application** : exécuter des requêtes dans `ENERGIE_BQ_PROJET`
(`roles/bigquery.jobUser`) et lire les jeux de données des vues et de leurs sources (`roles/bigquery.dataViewer`).

### Comment c'est lu

- Une requête réunit les vues en un seul format. Une facture présente dans plusieurs vues (même énergie, fournisseur,
  numéro, point de livraison) n'est gardée qu'une fois, version des flux d'abord.
- Les colonnes sont lues sans supposer leur présence : une colonne absente ou renommée dans une vue donne une valeur
  vide, pas une erreur.
- Les vues sont lentes (une dizaine de secondes) : elles sont lues en une fois puis gardées en mémoire. Après un quart
  d'heure, la lecture suivante répond aussitôt et relance la lecture en arrière-plan ; si BigQuery ne répond pas, les
  dernières données servent jusqu'à six heures.
- Le rapprochement se fait par le PDL / PCE (sans espaces ni zéros de tête) : la facture trouve son point de
  livraison, donc son contrat fournisseur, son site et son client.

### Ce qui reste dans Firestore

- Les factures **saisies à la main** (fournisseurs hors flux), collection `facturesEnergie`.
- Ce qui a été **refacturé au client** : la ligne de la facture client porte l'identifiant de la facture du
  fournisseur et ses montants, figés à l'émission. Rien ne dépend d'une relecture ultérieure de BigQuery.

### Où elles apparaissent

- Fiche du site, onglet Factures : factures du fournisseur avec leur origine, leur PDF et leurs composantes.
- Refacturation à l'euro l'euro (€€) : les factures datées depuis le début de la prestation sont proposées à la
  facturation, une seule fois. Si BigQuery ne répond pas, la facturation d'un contrat en refacturation est refusée
  plutôt que d'oublier des factures.
- Marge P1 : achats réels face au P1 facturé.
- Contrôles : facture hors contrat, fournisseur différent, et molécule facturée face au prix fixe du contrat (à 5 %
  près ; un prix indexé n'est qu'indiqué).

## Dérives P1 (Pilotage › Dérives P1)

Pour chaque site dont les achats d'énergie sont connus, la **marge P1** sur les douze derniers mois (P1 facturé face aux
factures du fournisseur, sur les mois complets), comparée à **la même période un an plus tôt** et au **taux de marge
budgété** (ligne P1 du budget de l'année du contrat : CA − énergie).

- **Seuils** (réglés par un administrateur, bouton « Seuils ») : marge sous 10 %, perte de plus de 10 points sur un
  an, plus de 5 points sous le budget ; au moins 3 mois complets pour juger. Un seuil franchi : « à surveiller » ;
  deux, ou une marge négative : « forte ».
- **Pourquoi** : variation du prix moyen d'achat (€ par unité facturée par le fournisseur), de la quantité achetée et
  du P1 facturé contre l'an dernier, et la cause la plus probable en clair. Le détail mois par mois des deux années
  se déplie ; liens vers le site, ses compteurs, les contrats d'énergie et le budget du contrat.
- **Mail récapitulatif** (événement « Sites en dérive de marge P1 », famille Contrats d'énergie, acheteurs et
  administrateurs par défaut) : au passage quotidien des rappels, le jour où un site **entre** en dérive ; il liste
  tous les sites en dérive, les nouveaux marqués. L'état du passage est gardé dans `derivesP1/etat`.
- Non pris en compte : les DJU (une hausse de consommation due à un hiver plus froid apparaît comme une hausse de
  consommation) ; à lire avec les relevés du site.

Calcul : `src/lib/energie/derives.ts`, `src/services/derives-p1-admin.ts`.
