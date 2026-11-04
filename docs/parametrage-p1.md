# Paramétrage P1 : ce qu'il faut saisir pour calculer

Ce document liste les paramètres à saisir sur les contrats, les sites et les
compteurs pour que le suivi P1 soit calculable : consommation (NC), cible corrigée
(N'B), écart, intéressement, prix révisé, facturation mensuelle et marge.

Il est établi à partir du moteur P1 (`veolia.com/vef/venf/suivi-techfi-p1`,
moteur v0.38) : chaque paramètre ci-dessous est un paramètre que ce moteur lit.
Les types proposés sont dans `src/lib/p1/parametrage.ts`.

**Partage des rôles.** Zenergya porte les **décisions contractuelles** : ce que
le marché stipule et que personne ne peut déduire d'une mesure. Les **données
mesurées** (relevés, DJU, consommations, factures d'achat, indices) viennent de
BigQuery et ne se saisissent pas (voir [§ 4](#4-ce-qui-ne-se-saisit-pas)).

## 1. Règles transverses

1. **Chaque valeur a une date d'effet et un motif.** Un avenant n'écrase pas une
   valeur : il ajoute une version valable à partir d'une date. Le calcul d'un mois
   prend la version en vigueur ce mois-là. Sans cet historique, un mois passé ne se
   recalcule pas à l'identique et une facture ne se justifie pas.
   Une valeur retirée garde la trace de son retrait (date, auteur, motif).
2. **Non renseigné n'est pas zéro.** Un champ vide reste vide (`null`), et le
   calcul répond « non calculable » avec sa cause. Un 0 par défaut produirait un
   montant faux sans le dire.
3. **Codes TWIMM sur chaque objet** : `code_contrat`, `code_site`,
   `code_compteur`, PDL/PCE et code immeuble. Ce sont les clés de jointure avec les
   données de BigQuery.
4. **Un paramètre vit à un seul niveau.** Aujourd'hui NB, DJU de référence et taux
   de partage sont portés à la fois par `Site`, `Service` et `Interest` : chacun
   doit avoir une seule source.

## 2. Ce qui est obligatoire selon le type de marché

Le type de marché détermine l'assiette facturée et donc tout le reste : il doit
piloter le formulaire de saisie.

| Marché | Assiette facturée | Prix de base + formule de révision | Cible NB + DJU de référence | Barème de partage | Autre |
| --- | --- | --- | --- | --- | --- |
| **MC** | NC (consommation réelle) | oui | – | – | |
| **MCI** | NC | oui | oui, sur le compteur de vente | oui | |
| **MT** | N'B (cible corrigée des DJU) | oui | oui, sur l'énergie entrante | – | |
| **MTI** | N'B | oui | oui, sur l'énergie entrante | oui | |
| **CP** | énergie entrante, refacturée | – (prix d'achat) | – | – | régime de refacturation |
| **CPI** | énergie entrante, refacturée | – | oui, sur l'énergie entrante | oui | régime de refacturation |
| **PFI** | aucune (pas de fourniture) | – | oui, sur l'énergie entrante | oui | prix de l'énergie du client |
| **PF** | hors suivi P1 | – | – | – | |

Le plan de comptage (formule de NC, [§ 3.4](#34-postes-de-consommation--formule-de-nc-et-engagement))
est nécessaire pour tous les marchés suivis. Un CP ou CPI en régime « révisé » se
comporte comme un marché à consommation : il demande un prix de base et une formule.

## 3. Paramètres par objet

### 3.1 Contrat

| Paramètre | Valeurs / remarque | Dans Zenergya aujourd'hui |
| --- | --- | --- |
| Code contrat TWIMM, code client TWIMM | clés de jointure | `externalRef` (à formaliser) |
| Dates, statut, agence | | `startDate`, `endDate`, `status` |
| Régime d'un compte de prestation (CP/CPI) | `refacturation` (euro/euro), `frais_gestion` (+ forfait annuel), `coefficient` (HT × coefficient), `revise` (NC au prix de base révisé) | absent |
| Coefficient de gestion, frais de gestion annuels | selon le régime | absent |
| Intéressement au contrat | oui / non, par marché : l'écart se partage une seule fois sur la somme des sites | absent |
| Répartition de la régularisation | reste au contrat, ou répartie au prorata du N'B des sites | absent |
| Plafond de l'intéressement | % du P2 total (ex. 50 %), plafonné ou non | absent |
| Contrat sans site | décision explicite | absent |

### 3.2 Site

| Paramètre | Valeurs / remarque | Dans Zenergya aujourd'hui |
| --- | --- | --- |
| Code site TWIMM | clé de jointure | absent |
| Rattachement au contrat | un seul contrat à une date donnée, historisé | `contractId` |
| **Type de marché** | voir § 2, **daté** | `Service.heatingContractType` (texte libre) |
| Période de référence | `saison_de_chauffe` ou `annee_civile`, datée | absent |
| Prix de base chauffage (€/MWh) | daté : socle puis versions d'avenant | `Service.unitPrice` |
| Prix de base ECS (€/m³) | daté | `Service.unitPrice` |
| Station météo | code de la station | `heatingWeatherStation` |
| Entité, secteur, client | | partiel |
| Prix de l'énergie du client (PFI) | par saison : prix, ou montant HT et quantité | absent |
| P2 unitaire | par exercice, avec le document d'origine (plafond de l'intéressement) | absent |
| Références du site chez son client | numéro ou libellé dans les documents du client | absent |
| Périmètre d'intéressement | par exercice : le site entre-t-il dans le calcul global du contrat | absent |

### 3.3 Compteurs

| Paramètre | Remarque | Dans Zenergya aujourd'hui |
| --- | --- | --- |
| Code compteur TWIMM | | `code` (interne seulement) |
| Type et unité | énergie entrante, vente, ECS, eau froide… | `type`, `unit` |
| **Coefficient de conversion (QE)** | index → MWh. Vide si inconnu, jamais 1 par défaut | `Service.conversionCoefficient` |
| qECS | coefficient des compteurs d'ECS volumétriques | absent |
| PDL / PCE | rapprochement des factures d'achat | `reference` |
| Énergie | gaz, fioul, bois, électricité, réseau de chaleur… : choisit la formule de révision | absent |

### 3.4 Postes de consommation : formule de NC et engagement

Pièce centrale du calcul, absente de Zenergya : aujourd'hui l'intéressement porte
sur un seul compteur.

| Paramètre | Remarque |
| --- | --- |
| Désignation | un site peut porter plusieurs postes (ex. chaufferie bois et chaufferie gaz) |
| **Formule de NC** | compteurs signés : `+` entrée, `−` déduction (ECS, sous-comptage). Un compteur absent de la formule ne compte pas |
| **Cible NB** et son unité | MWh, ou t / L ramenés au MWh. Datée |
| **DJU de référence** | daté |

> À arbitrer avec le moteur P1 : il a décidé que la cible NB, le DJU de référence
> et le qECS ne se saisissent pas et viennent uniquement de TWIMM (décisions des
> 19 et 21/10/2026). Si Zenergya devient la source des sites, ces décisions sont à
> revoir ensemble pour éviter deux sources de vérité.

### 3.5 Postes de facturation (par site)

| Paramètre | Valeurs |
| --- | --- |
| Libellé, rang | |
| Type | `chauffage`, `ecs`, `annexe`, `autre` |
| Compteurs concernés | |
| Unité du prix | `EUR/MWh`, `EUR/m3`, `EUR/t`, `EUR/L` |

### 3.6 Formules de révision (par contrat, avec un périmètre)

| Paramètre | Valeurs / remarque |
| --- | --- |
| Usage | `chauffage` ou `ecs` |
| Périmètre | tout le contrat, des énergies, ou une liste de sites. Le plus précis l'emporte : site, puis énergie, puis contrat |
| Forme | **A** : somme des rapports d'indices ; **B** : rapport des sommes |
| Mode, base énergétique | `standard` / `derogatoire` ; `PCS` / `PCI` |
| Prix de base K0, unité, date M0 | la date M0 peut manquer : le dire plutôt que la supposer |
| **Termes** | code (p0, Kmol, TVD, Accise, CEE, CPB, Infra), coefficient, indice, valeur de base, valeur contractuelle ou non. Un terme peut être un **panier** d'indices |
| Prix de la molécule | variable, ou fixe avec son prix négocié |
| Prix non révisable | oui / non |
| **Périodicité** | `mensuel` (indice du mois), `annuel_dju` (moyenne pondérée DJU), `annuel_temps` (moyenne au prorata des jours), `annuel_cloture` (indice connu à la clôture) |
| Versions | une par avenant, avec date d'effet et motif |

`RevisionRule` couvre aujourd'hui la moyenne pondérée et la forme a + b × Σ sur N
mois. Il manque la forme B, les paniers, les termes du gaz et les versions datées.

### 3.7 Barème de partage (contrat × marché, éventuellement site)

| Paramètre | Remarque |
| --- | --- |
| Sens | `economie` ou `depassement` |
| Tranches | bornes en % du N'B, part du client par tranche |
| Contrôle | pour un même sens, les tranches partent de 0 % et se suivent sans trou ni chevauchement |

Zenergya n'a aujourd'hui qu'un `sharingPercentage` unique.

### 3.8 Qualification des achats (contrat × marché × énergie, éventuellement site)

Pour chaque composante d'une facture d'achat : `variable` ou `fixe`, refacturée
au client ou non, retenue ou non au K FINAL.

### 3.9 Réglages généraux (administration)

| Réglage | Valeur actuelle du moteur |
| --- | --- |
| Période de référence par défaut | saison de chauffe |
| Méthode d'affectation par défaut | prorata |
| Couverture des DJU (basse / haute) | 0,7 / 1,15 |
| Écart relatif aberrant | 60 % |
| Rendement (min / max) | 0,5 / 1,05 |
| Écart achats / relevés | 5 % |
| Report d'un indice manquant | 3 mois |
| Variation mensuelle du prix | 25 % |
| Part estimée (alerte) | 20 % |
| Écart à la référence d'achat | 20 % |

## 4. Ce qui ne se saisit pas

Ces données viennent de BigQuery et ne sont pas des paramètres :

- les relevés de compteurs, et les dates d'allumage et d'arrêt qui s'en déduisent ;
- les DJU journaliers par station ;
- les consommations TWIMM ;
- les factures d'achat d'électricité et de gaz ;
- les indices (déjà récupérés par Zenergya : INSEE, PEG, CEE).

## 5. Mise en œuvre proposée

1. Ajouter les codes TWIMM (contrat, site, compteur).
2. Ajouter les objets manquants avec leur historique daté : postes de
   consommation, barème par tranches, formules complètes, régime CP,
   intéressement au contrat.
3. Supprimer les doublons entre `Site`, `Service` et `Interest`.
4. Afficher un « reste à faire » par site, piloté par la grille du § 2 : savoir
   quels sites sont calculables avant même que les données arrivent.
5. Exporter ce paramétrage vers BigQuery (tables `p_*` du moteur) pour que le
   moteur P1 le lise à la place du Google Sheet, puis relire ses résultats
   (`p1_facturation_*`, `p1_site_*`) pour facturer et suivre les contrats.
