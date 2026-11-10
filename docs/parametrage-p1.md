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
3. **Les codes Zenergya sont les identifiants maîtres** du contrat, du site et
   du compteur : chronologiques, lisibles et immuables, comme `CLI-00001` et
   `CTN-00001` aujourd'hui. Le paramétrage exporté et les résultats du calcul sont
   indexés par ces codes.
   Les **codes TWIMM ne sont qu'une correspondance**, datée, tenue tant que des
   données de BigQuery (relevés, DJU, consommations) restent indexées par TWIMM.
   Le PDL/PCE et le code immeuble servent de même à rapprocher les factures
   d'achat. Quand une source ne sera plus indexée par TWIMM, sa correspondance
   s'éteint sans rien changer au reste.
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
| **Code contrat Zenergya** | identifiant maître | `contractNumber` (`CTN-00001`) |
| Correspondance TWIMM (code contrat, code client) | datée, tant qu'une source est indexée par TWIMM | `externalRef` (à formaliser) |
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
| **Code site Zenergya** | identifiant maître, chronologique et immuable (ex. `SIT-00001`) | `siteNumber` facultatif et saisi : à générer comme `CTN` |
| Correspondance TWIMM (code site) | datée, tant qu'une source est indexée par TWIMM | absent |
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
| **Code compteur Zenergya** | identifiant maître, chronologique et immuable (ex. `CPT-00001`) | `code` = identifiant Firestore : à remplacer par un code lisible |
| Correspondance TWIMM (code compteur) | datée : un compteur remplacé change de code TWIMM | absent |
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
| Compteurs concernés | codes compteur Zenergya |
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

1. Générer des codes Zenergya immuables pour les sites et les compteurs (comme
   les clients et les contrats), et tenir une correspondance TWIMM datée pour les
   sources encore indexées par TWIMM.
2. Ajouter les objets manquants avec leur historique daté : postes de
   consommation, barème par tranches, formules complètes, régime CP,
   intéressement au contrat.
3. Supprimer les doublons entre `Site`, `Service` et `Interest`.
4. Afficher un « reste à faire » par site, piloté par la grille du § 2 : savoir
   quels sites sont calculables avant même que les données arrivent.
5. Exporter ce paramétrage vers BigQuery (tables `p_*` du moteur), indexé par
   les codes Zenergya, avec la table de correspondance TWIMM : le moteur P1 le lit
   à la place du Google Sheet et rapproche les données TWIMM par la
   correspondance. Ses résultats (`p1_facturation_*`, `p1_site_*`), indexés par
   les codes Zenergya, se relisent pour facturer et suivre les contrats.

## 6. Mis en œuvre : fondations (paramétrage daté)

Code : `src/lib/p1/stockage.ts` (versions, contrôles, reste à faire), `src/services/p1-admin.ts` (écritures),
écran « Paramétrage P1 » de la fiche site (`src/components/p1/p1-parametrage-panel.tsx`), import « Paramétrage P1 ».

- **Collection `p1Parametrage`**, écrite par le serveur seulement (lisible par les utilisateurs) : un document par
  site (`site:<id>`, avec ses postes de consommation), par compteur (`meter:<id>`) et par contrat (`contract:<id>`).
- **Versions datées** : chaque paramètre est une liste de versions (valeur, date d'effet — vide : valeur
  d'origine —, motif, pièce, auteur, horodatage). Une nouvelle valeur ajoute une version ; une version active à la
  même date est refusée (la retirer d'abord) ; un retrait est tracé (date, auteur, motif) et la version reste dans
  l'historique. La valeur d'un jour est la version active la plus récente à cette date.
- **Paramètres** :
  - site : type de marché, période de référence, prix de base chauffage et ECS, station météo, code TWIMM ;
  - poste de consommation : formule de NC (compteurs du site signés), cible NB et son unité, DJU de référence ;
  - compteur : usage, énergie, coefficient QE (jamais 1 par défaut), qECS, code TWIMM ;
  - contrat : régime du compte de prestation, coefficient et frais de gestion, code TWIMM, intéressement au
    contrat (par marché : répartition, plafond).
- **Source unique** : la cible NB, le DJU de référence et le qECS sont saisis dans Zenergya (décision du
  05/11/2026 : engagements contractuels ; le moteur P1 les lira depuis l'export, sa décision des 19 et 21/10/2026
  est à revoir). L'intéressement lit cible, DJU, QE et station dans le paramétrage P1 en vigueur au début de la
  saison (à défaut, l'ancienne saisie de la prestation, signalée) ; sans QE connu, il ne se calcule pas. Le
  formulaire de prestation ne saisit plus ces valeurs.
- **Reste à faire** par site, à une date, selon la grille du § 2 : ce qui manque pour calculer ; le barème de
  partage et le prix de l'énergie PFI sont signalés pour le lot suivant.
- **Reprise** : `npm run p1:reprise` (simulation), puis `-- --apply` : station, type de marché (s'il est dans la
  grille), poste « Chauffage » (compteur de la prestation, cible, DJU), QE (sauf 1, signalé à vérifier).

## 7. Mis en œuvre : barèmes de partage et formules de révision P1

Code : `src/lib/p1/bareme.ts`, `src/lib/p1/formules.ts` (calculs repris du moteur P1, `moteur/marche.py` et
`moteur/revision.py`), écran « Paramétrage P1 » de la fiche site, imports « Paramétrage P1 » et « Formules de
révision P1 ».

- **Barème de partage** (paramètre daté `bareme:<marché>` du contrat, ou du site qui l'emporte) : tranches par sens
  (économie, dépassement), bornes en % du N'B, part du client. Saisie : « économie 0-10 % 50 % ; économie 10-100 %
  70 % ; dépassement 0-100 % 30 % ». Contrôle RG-53 (tranches contiguës depuis 0 %) ; un sens sans tranche : partage
  nul, signalé.
- **Partage et régularisation** (RG-53, RG-54) : écart = N'B − NC découpé par tranches ; sur un MTI seule la part du
  client circule ; sur un MCI, CPI, PFI la part de l'exploitant est facturée (économie) ou rendue (dépassement).
  L'écran d'intéressement applique le barème en vigueur (à défaut, l'ancien pourcentage unique, signalé).
- **Formules de révision P1** (contrat) : nom, usage (chauffage, ECS), périmètre (contrat, énergies, sites : la plus
  précise l'emporte), versions datées : forme A (Σ aᵢ Iᵢ/Iᵢ₀, pondérations à 100 %) ou B (Σ cᵢ Iᵢ / Σ cᵢ Iᵢ₀), mode,
  base énergétique, unité, mois M0 (ou ce qui manque), régime de la molécule (prix négocié en fixe), prix fixe,
  périodicité (mensuel, annuel_temps, annuel_dju, annuel_cloture), termes (indice, panier d'indices et de valeurs
  fixes, valeur de base M0, base contractuelle, actif). Saisie des termes : `p0=0,15 ; Kmol=0,6*PEGMA@20 ;
  CEE=0,1*(1*CL+0,5*PR)@5!`.
- **Prix de base : celui du site** (décision du moteur du 27/10/2026) ; prix révisé = prix de base × coefficient.
- **Indices** (RG-38, RG-40) : valeur du mois = dernière publiée jusqu'à ce mois ; reportée : prix provisoire, alerte
  au-delà de 3 mois ; aucune : non calculable. **Contrôle à M0** (RG-41) : coefficient 1 au mois M0, sinon formule à
  corriger (sauf base contractuelle : signalé).
- **Reste à faire** : formule chauffage retenue pour le site et ses anomalies (dont M0), barème du marché.
- **Aperçu** : prix révisés sur 12 mois (prix de base, coefficient, prix du mois, prix retenu selon la périodicité).

Lots suivants : qualification des achats, postes de facturation, prix de l'énergie PFI, P2 par exercice, périmètre
d'intéressement ; acomptes P1 ; puis export vers BigQuery (tables `p_*`) et relecture des résultats du moteur.

## 8. Où se paramètre le P1

Le stockage reste unique (`p1Parametrage`, versions datées écrites par le serveur) ; chaque paramètre se saisit sur
l'élément qui le porte :

| Élément | Écran | Import | Paramètres |
|---|---|---|---|
| Site | Fiche du site › Paramétrage P1 | Sites (colonnes « P1 · … ») | type de marché, prix de base, station, acomptes, TWIMM ; postes : formule de NC, cible NB, DJU |
| Compteur | Compteurs › bouton P1 (aussi depuis la fiche du site) | Compteurs | usage, énergie, QE, qECS, TWIMM |
| Contrat | Fiche du contrat › Paramétrage P1 du contrat | Contrats | régime CP, gestion, répartitions, intéressement, barèmes, formules de révision |

- La fiche du site montre en lecture les paramètres de ses compteurs et de son contrat (calculabilité, reste à faire),
  l'aperçu des prix révisés et le **réel P1 du moteur** importé (base de la régularisation).
- **Anciennes saisies** : les valeurs P1 des assistants de création de contrat (DJU, station, NB ; depuis un PDF,
  DJU et NB du contrat mono-site) deviennent des versions d'origine **à la validation du contrat** (motif « création
  du contrat CTN-… ») ; un paramètre qui a déjà une version n'est pas touché. Le coefficient de conversion n'est plus
  saisi sur la prestation : c'est le QE du compteur. `npm run p1:reprise` reprend une fois l'existant (même logique,
  `src/services/p1-reprise-admin.ts`).


## 9. Facturation P1 au compteur (chauffage et ECS)

Code : `src/lib/billing/p1-compteur.ts` (calcul), `src/lib/billing/contract-billing.ts` (échéances, lignes),
`src/services/contract-billing-admin.ts` (compteurs, relevés, QE, coefficient du contrat, DJU).

Prestation P1 de type chauffage ou ECS, « Facturation P1 : au compteur », à terme échu, mensuelle ou trimestrielle
(toute périodicité : chaque mois est calculé et détaillé dans la ligne de facture, base de l'annexe).

- **Consommation du mois**, par compteur : index du dernier relevé du mois − index du dernier relevé facturé de la
  prestation (à défaut, dernier relevé antérieur au mois). Un même compteur peut servir à deux prestations (ECS facturée
  et déduite du chauffage) : le dernier index facturé est suivi par prestation.
- **Compteurs** : celui de la prestation ; sinon, en chauffage, les compteurs signés de la formule de NC des postes du
  site (entrées − déductions), à défaut ceux d'usage « vente », puis « entrant » ; en ECS, ceux d'usage « ecs ».
- **Unités** : chauffage en MWh (compteur en MWh, en kWh, ou × QE du compteur ; jamais 1 par défaut) ; ECS en m³.
- **Prix du mois** : paramétrage P1 (prix de base du site × formule de révision P1 du mois) ou prix unitaire de la
  prestation × sa révision ; × **coefficient de gestion** : aucun, celui de la prestation, ou celui du contrat
  (paramétrage P1 daté, `coefficientGestion`) — chaque prestation choisit.
- **Mois partiel** (début ou fin de contrat, de prestation) : périodes calées sur les mois civils ; méthode choisie par
  prestation : relevé à la date de coupure s'il existe, sinon prorata des jours (défaut) ou des DJU de la station du
  site ; ou toujours jours, toujours DJU. Un mois sans DJU (été) se proratise aux jours.
- **Blocages** (facture non émise, cause affichée) : relevé du mois manquant, index en baisse, QE inconnu, quantité
  négative (formule de NC), prix ou coefficient du contrat non renseigné, DJU manquants.
- **Relevés figés** : tous les relevés pris (début et fin de chaque mois et compteur) ne se modifient plus.
- **Régularisation** : un usage facturé au compteur est déjà au réel, il ne se régularise pas (réel total refusé).
- **Ligne de facture** : `p1Releve` garde le détail par mois (`detail` : dates, méthode, ratio, DJU, compteurs et
  index, quantité, prix de base, coefficient et termes de révision, coefficient de gestion, prix appliqué, montant).

## 10. MTI : facturation au DJU et décompte

Règles métier : [p1-regles-metier.md](p1-regles-metier.md). Code : `src/lib/billing/contract-billing.ts` (`mtiAuDju`),
`src/lib/billing/p1-decompte.ts`, `src/lib/p1/saisons.ts`, `src/lib/p1/formules.ts` (`coefficientSaison`),
`src/services/p1-regularisation-admin.ts` (`decomptesMti`).

- **Saisons de chauffe** (fiche du site › Paramétrage P1 › Saisons de chauffe ; collection `saisonsChauffe`, écrite
  par le serveur) : dates d'allumage et d'arrêt par saison (juillet → juin). Un mois d'hiver (octobre à mai) sans
  saison saisie bloque la facture au DJU et le décompte ; l'été sans saison : hors saison.
- **MTI au DJU** (prestation P1 chauffage, « Facturation P1 : MTI au DJU », mensuelle à terme échu) : le montant de la
  prestation est le P1 annuel de base du site. Chaque mois : partie chauffée (allumage → arrêt), DJU de la station du
  site sur cette partie (arrondis au centième), montant = arrondi(P1 annuel × C/C0 du mois / DJU contractuels × DJU, 2).
  DJU contractuels : DJU de référence du poste de consommation. Hors saison : pas de ligne.
- **Acomptes puis décompte** (prestation en acomptes ; paramètre du contrat « Régularisation des acomptes » =
  `decompte_dju`) : la régularisation calcule, par saison terminée (arrêt saisi), P1 dû = arrondi(quantité de
  référence × prix de base × C/C0 annuel × DJU de la saison / DJU contractuels, 2), C/C0 annuel = moyenne des
  coefficients mensuels pondérée par les DJU (allumage et arrêt au prorata), arrondie comme la formule ; P1 dû réparti
  par mois au prorata des DJU, comparé aux acomptes ; ligne « Décompte P1 chauffage MTI » avec son détail
  (`p1Regul.decompte`). Les intéressements de la période s'ajoutent comme avant. Acomptes 1/7 : répartition
  « 14,2857 » sur les 7 mois de la saison.
- **Formules de révision** : facteur fixe d'avenant (multiplie C/C0) et arrondi du coefficient (ex. 5 décimales),
  saisis dans la version de la formule (écran ou import « Formules de révision P1 » : colonnes « Facteur fixe »,
  « Arrondi du coefficient »).
- **ECS déduite d'une formule de NC** : convertie par le qECS du compteur (MWh PCS / m³), à défaut son QE.

## 11. Annexe P1 des factures et des avoirs

Code : `src/lib/billing/p1-annexe.ts` (contenu, logique pure), `src/lib/pdf/accounting-document.tsx` (pages PDF),
`src/lib/billing/p1-annexe-xlsx.ts` (tableur), `src/services/document-archive.ts`, route
`/api/documents/{invoices|credit-notes}/{id}/annexe` (`?format=xlsx` pour le tableur).

- **Contenu**, par façon de facturer présente dans le document (une annexe chacune) : P1 chauffage au compteur, P1 ECS
  au compteur, MTI au DJU, acomptes, décompte MTI, régularisation sur le réel. Chaque annexe porte la formule en clair
  et ses références (DJU contractuels, unité), le tableau de révision (indices du mois, valeurs de base, C/C0 ; un
  tableau par jeu d'indices si les sites n'ont pas les mêmes), une ligne par site et par mois (index M-1 et M avec
  leurs dates, consommation, conversion, prorata, PU de base, C/C0, coefficient de gestion, PU final ; ou base,
  montant révisé, période de chauffe, DJU ; ou P1 dû, acomptes), les montants HT, TVA, TTC et les totaux. Une formule
  de NC à plusieurs compteurs : une ligne grisée par compteur, puis le total du mois. Index estimé : « (e) ».
- **Tout vient du détail figé dans les lignes** du document (`p1Releve.detail`, `p1Dju`, `p1Acompte`, `p1Regul`) :
  l'annexe d'une facture émise ne change plus, et se recalcule à l'identique.
- **Dans le PDF** de la facture ou de l'avoir : pages paysage à la suite du document (archivées avec lui) ; sur la
  facture, la désignation des lignes P1 est raccourcie (« détail en annexe »). Un document sans P1 détaillé n'a pas
  d'annexe. Les factures archivées avant cette évolution gardent leur PDF d'origine ; leur annexe reste disponible
  seule si leurs lignes portent le détail.
- **Seule** : boutons « Annexe P1 » (PDF) et « Annexe (tableur) » sur la fiche de la facture, entrées du menu de la
  liste des factures, icône sur la liste des avoirs. Tableur : un onglet par annexe, valeurs numériques brutes.
- **TVA** : par ligne à titre indicatif, la dernière ligne de chaque taux ajustée pour que la somme soit la TVA du
  total HT de l'annexe à ce taux (plus de correction manuelle au centime) ; la TVA de la facture reste calculée sur le
  total HT par taux.
