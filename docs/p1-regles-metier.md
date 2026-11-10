# P1 : règles métier de facturation (à valider)

Synthèse établie à partir de deux classeurs de facturation P1 en service (un contrat de ville, marchés MTI et MCI ; une
copropriété, marché MTI avec ECS, CEE et refacturation €/€). Les exemples ci-dessous sont **anonymisés** ; les montants
servent à fixer les règles de calcul et d'arrondi. Chaque règle validée deviendra un test automatique.

Statut : **proposition, à valider par le métier.** Les points ouverts sont en fin de document.

## 1. Trois façons de facturer le P1 chauffage

| Mode | Marchés | Montant de l'échéance | Données |
|---|---|---|---|
| **Au compteur** | MC, MCI | PU de base du site × C/C0 × MWh relevés (compteur M − compteur M-1) | relevés, PU par site (acte d'engagement), indices |
| **Au DJU, mensuel** | MTI (sans décompte) | P1 annuel de base du site × C/C0 × DJU de la période / DJU contractuels | DJU de la station, dates d'allumage et d'arrêt, indices |
| **Acomptes puis décompte** | MTI (avec décompte) | acompte : P1 annuel révisé / nombre de mois de la saison ; décompte en fin de saison | idem, plus la liste des acomptes facturés |

### 1.1 Au compteur (MC, MCI)

- Consommation = (index M − index M-1) ; un compteur de chaleur en kWh est ramené en MWh (÷ 1 000) ; un compteur gaz
  en m³ × coefficient de conversion (ex. 14,47 kWh PCS/m³).
- Le compteur M-1 du mois doit être le compteur M du mois précédent (contrôle).
- PU révisé = PU de base du site × C/C0 ; montant = arrondi(MWh × PU révisé, 2).
- ECS au compteur : PU de base €/m³ × C/C0, **PU révisé arrondi à 2 décimales**, × m³.

### 1.2 MTI au DJU, mensuel

- Montant révisé annuel du site = P1 annuel de base × C/C0 (C/C0 arrondi à 5 décimales).
- Montant du mois = arrondi(montant révisé / DJU contractuels × DJU de la période, 2).
- DJU de la période : DJU journaliers de la station de référence (méthode et base précisées au contrat, ex. 18 °C,
  Météoclim ou COSTIC), **bornés par les dates d'allumage et d'arrêt propres à chaque site** : la première facture de la
  saison commence à l'allumage, la dernière s'arrête à l'arrêt ; hors saison, pas de facture (« pas de facture »).

### 1.3 MTI : acomptes puis décompte

- Acompte mensuel pendant la saison = arrondi(P1 annuel de base × C/C0 du mois, 2) / nombre de mois de la saison (ex. 1/7).
- **Décompte** en fin de saison :
  - C/C0 annuel = moyenne des C mensuels **pondérée par les DJU** de chaque mois (mois d'allumage et d'arrêt au prorata),
    arrondie à 5 décimales ;
  - P1 dû = arrondi(P1₀ × C/C0 annuel × DJU réels de la saison / DJU contractuels, 2) ;
  - décompte = P1 dû − Σ acomptes facturés (chaque acompte listé avec son numéro de facture) : facture ou avoir.
- La part **CEE** est suivie à part (« dont gaz / dont CEE ») : acompte CEE = NB × CEE₀ / nombre de mois ; décompte CEE =
  CEE annuel × indice CEE moyen / CEE₀ × DJU réels / DJU contractuels − acomptes CEE.

## 2. Révision des prix (C/C0)

- C = somme de termes d'indices du mois (ex. prix de la molécule PEG + acheminement ATRD + TICGN + CEE), C0 = même
  somme aux valeurs de base : **rapport des sommes** (forme B).
- L'acheminement dépend du site (**T2 ou T3**) : deux coefficients pour un même contrat, chaque site prend le sien.
- Un avenant peut ajouter un **facteur fixe** au coefficient (ex. remplacement d'un indice qui n'est plus publié :
  (indice de substitution à la date de l'avenant + taxe) / (indice d'origine + taxe d'origine)), qui multiplie C/C0.
- Coefficient arrondi à **5 décimales**.
- Prix de la molécule figé (« prix fixe ») sur une période : la valeur reste constante.
- ECS trimestrielle : C de la période = moyenne des 3 mois **pondérée par le nombre de jours**.

## 3. Intéressement (MTI)

- NC (MWh PCS) = (relevé gaz à l'arrêt − relevé gaz à l'allumage) × coefficient de conversion − ECS (m³) × qECS
  (ex. 0,13 MWh PCS/m³).
- N'B = NB × DJU réels de la saison / DJU de référence (**arrondi au MWh** dans le décompte).
- Franchise : ±4 % autour de N'B (N'B1 = 0,96 × N'B, N'B2 = 1,04 × N'B) ; économie au-delà : partagée 1/2 ;
  dépassement au-delà : à la charge de l'exploitant (100 %).
- Montant = quantité en partage × PU HT du MWh ; facturé avec le décompte (même facture).

Le barème par tranches de Zenergya l'exprime : « économie 0-4 % 0 % ; économie 4-100 % 50 % ; dépassement 0-4 % 0 % ;
dépassement 4-100 % 100 % » (part du client), à vérifier sur le sens de la quantité (§ 6).

## 4. Refacturation €/€ (parts fixes et taxes)

- À partir des factures du fournisseur d'énergie (une ligne par facture : PCE, période, index, m³, coefficient PCS, MWh,
  prix de la molécule, montants par composante : consommation, ATRD variable et fixe, ATRT transport et stockage, CEE,
  TICGN, abonnement, CTA, location du compteur, autres prestations, pénalités, HT, TVA 20 % et 5,5 %, TTC, site, type de
  marché).
- Refacturées **à l'identique** sur la période, une ligne par composante et par site, **chacune avec son taux de TVA**
  (ex. abonnement et CTA à 5,5 %, TICGN et location du compteur à 20 %) ; un coefficient de gestion peut s'appliquer.
- Rythme : annuel ou semestriel (au choix du contrat).

## 5. Facture et annexe

- **Une facture par prestation** : chaque prestation a son propre numéro de contrat client (P1 chauffage, P1 ECS, part
  fixe €/€, intéressement), donc sa facture et son annexe.
- Annexe :
  - en-tête : client, prestation, saison ou exercice, échéance au, période, références du marché, n° de contrat,
    n° de facture ;
  - formule de calcul en clair (ex. « P1 MTI = P1₀ × DJU / DJU contrat × C/C0 ») et ses références (DJU contractuels,
    station) ;
  - tableau de révision : chaque indice à la base et au mois, coefficient(s) ;
  - une ligne par site : base, montant ou PU révisé, période (allumage, arrêt) ou compteurs M-1 / M, DJU ou MWh, montant
    HT, taux de TVA, TVA, TTC ; puis les totaux HT, TVA, TTC ;
  - le détail interne (ex. calcul CEE) ne part pas chez le client.
- Une fois facturée, l'annexe est figée (copie « facturé ») : c'est elle que le décompte reprend.

## 6. Décisions (09/11/2026)

1. **TVA** : calculée sur le total HT par taux (règle de la facture). L'annexe montre la TVA par ligne et ajuste la
   dernière ligne pour retomber sur la facture : plus de correction manuelle de ±0,01 €.
2. **Trimestriel au compteur** : s'il y a un relevé chaque mois, détail mois par mois (prix de chaque mois) ; sinon un
   seul écart début / fin de trimestre, au prix moyen pondéré par les jours.
3. **Factures** : une seule facture par contrat par défaut (ce que l'outil actuel ne permettait pas) ; regroupement
   par prestation (avec son numéro de contrat client) possible quand le contrat l'exige.
4. Ordre de réalisation : MTI au DJU et décompte (dates d'allumage et d'arrêt, facteur d'avenant, arrondis), puis
   l'annexe, puis la refacturation €/€.

## 7. Points ouverts

1. **Intéressement** : sens de la quantité en partage (économie : 1/2 de l'écart au-delà de la franchise, au crédit de
   qui ?), arrondi de N'B (au MWh) et de NC.
2. **Facteur fixe d'avenant** dans la révision : à généraliser (terme multiplicatif daté) ?
