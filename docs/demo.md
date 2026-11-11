# Démo avec données simulées

Tester l'application sans toucher à aucune donnée réelle : tout tourne dans les émulateurs Firebase (authentification,
Firestore, stockage), remplis d'un jeu de données **fictif**, et s'efface à l'arrêt. Aucun projet Firebase ni ressource
cloud n'est utilisé.

## Lancer dans Cloud Shell

`/home` (4,8 Go) est trop petit pour les dépendances et le build (environ 2,2 Go) : la démo se lance depuis `/tmp`
(effacé au redémarrage de Cloud Shell, il suffit de recloner).

```bash
cd /tmp && git clone https://github.com/Shironeki13/Zenergya.git zenergya-demo && cd zenergya-demo
npm run demo          # dépendances si besoin, émulateurs, données, build, application : 5 à 10 minutes
```

Puis **Aperçu sur le Web › Modifier le port › 3100**. `Ctrl+C` arrête tout. Relance plus rapide (même build) :
`bash scripts/demo/demarrer.sh --sans-build`.

Le script passe de lui-même à Node 22 (nvm) : firebase-admin ne fonctionne pas avec le Node 26 de Cloud Shell.

## Comptes de test

Mot de passe commun : `Demo-Zenergya-2026`.

| Compte | Rôle | Pour tester |
|---|---|---|
| `adv@example.com` | ADV (Claire Martin) | listes, fiches, facturation, saisie d'avenants / OS / reconductions… avec pièce |
| `adv2@example.com` | ADV (Julien Petit), **limité à l'agence Paris Est**, sans le module Achats | périmètre : ne voit que les clients, contrats, sites, factures, devis et affaires de Paris |
| `contratheque@example.com` | Contrathèque | validation des documents : contrôle champ par champ, corrections, refus |
| `admin@example.com` | Administrateur, sans le droit contrathèque | utilisateurs et rôles ; ne voit pas la validation |
| `technicien@example.com` | Exploitation (Lucas Morel) | saisit des commandes d'achat et ses heures ; son N+1 est le responsable |
| `technicienne@example.com` | Exploitation (Inès Colin) | saisit ses heures (coût horaire propre : 46 €/h) |
| `responsable@example.com` | Exploitation (Nadia Roche) | valide en N+1 les commandes du technicien, saisit ou importe les heures de son équipe ; son N+1 est le directeur |
| `directeur@example.com` | Exploitation (Paul Garnier) | valide en N+2 |
| `achats@example.com` | Achats (Élise Faure) | valide au-delà du seuil achats ; saisit les factures fournisseurs |

Périmètre et modules : `adv@`, `contratheque@`, `achats@` et `admin@` voient toutes les agences ; `adv2@` ne voit que
Paris Est ; les comptes d'exploitation (`technicien@`, `technicienne@`, `responsable@`, `directeur@`) ne voient que
l'agence de Lyon et n'ont que les modules Travaux et Achats. Voir `perimetre.md`.

## Contenu du jeu de données

Créé par `scripts/demo/donnees.ts` au travers du moteur d'import et du moteur de facturation de l'application (codes,
liens et montants sont donc ceux que l'application produirait) :

- référentiels : une société, 2 agences, 3 secteurs, typologies, activités P1 / P2 / P3, TVA, périodicités, termes,
  conditions de paiement, types de compteurs, un marché ;
- 12 clients (copropriétés avec syndic, bailleur, collectivités avec SIRET fictif, tertiaire, un prospect) et 22 contacts
  (deux clients sans contact de facturation) ;
- 13 contrats (actifs, un terminé), 18 sites, 33 prestations, 19 compteurs, 721 relevés de fin de mois (des relevés
  estimés, un mois manquant) ; paramétrage P1 de 4 sites (voir ci-dessous) ;
- 27 factures émises par le moteur (avril, juillet, octobre 2026), dont les lignes P1 au compteur et les acomptes, payées, dues ou en retard ;
- à valider par la contrathèque : 3 contrats de base marché (avec PDF, sans PDF, refusé), 2 avenants dont un **mal
  saisi** (nouvelle fin 30/06/2029 au lieu du 30/06/2030 du PDF : à corriger au contrôle), un OS, une reconduction, une
  résiliation, un changement de syndic, un changement de BE ; plus un historique déjà validé ou refusé ;
- des pièces PDF fictives pour chacun de ces documents.

### P1 : facturation au compteur, acomptes, intéressement

| Site (contrat) | Marché | P1 | À tester |
|---|---|---|---|
| Tilleuls - Bâtiment A (`CTN-00001`) | MTI | chauffage au compteur **trimestriel** (formule de NC gaz − ECS, coefficient de gestion du contrat 1,03) ; ECS au compteur mensuelle (coefficient propre 1,05) | annexe de 3 mois, même compteur ECS dans deux prestations |
| Tilleuls - Bâtiment B (`CTN-00001`) | MTI | chauffage au compteur mensuel, sans coefficient ; relevé d'octobre 2026 **absent** | facture de novembre bloquée (« aucun relevé… en 10/2026 ») ; intéressement (économie) |
| Belvédère (`CTN-00003`) | MCI | chauffage en **acomptes** (1 100 MWh, répartition saisonnière), réel P1 2025-2026 importé ; ECS au compteur | régularisation (réel − acomptes) ; intéressement (dépassement) |
| École Jules-Exemple (`CTN-00006`) | MT | chauffage au compteur mensuel, début le **15/09/2025** (prorata « relevé sinon DJU »), coefficient propre 1,04 | septembre au prorata des DJU |
| Mairie, Gymnase (`CTN-00005`) | MTI | **MTI au DJU** mensuel, sans décompte (modèle d'un contrat de ville), saisons de chauffe saisies | factures limitées à la saison ; octobre depuis l'allumage |
| Square Voltaire (`CTN-00007`) | MTI | **acomptes 1/7** d'octobre à avril, régularisation « décompte MTI », intéressement avec franchise ±4 % ; ECS au compteur trimestrielle | Facturation › Régularisation P1, période 07/2025 → 06/2026 : décompte (avoir) |

Données : 2 stations météo fictives (DJU journaliers depuis 07/2023), indices PEGFM et ATRDFM (formules de révision P1,
base M0 = janvier 2024), relevés de fin de mois liés aux DJU. L'intéressement se calcule sur la fiche du site
(prestation P1 › « Gérer l'intéressement »), saison du 01/10/2025 au 31/05/2026, relevés du 30/09/2025 et du
31/05/2026 ; l'onglet **Intéressement (calcul)** de l'extraction refait le calcul par des formules Excel.

### Travaux et analytique

- 5 devis : un P5 accepté avec acompte facturé et son devis complémentaire (même affaire), un P5 accepté non facturé,
  un P6 par situations (une situation facturée, retenue de garantie), un devis envoyé en attente.
- 3 affaires (Travaux › Affaires) avec leur budget prévu par nature et leur code analytique ; les agences et secteurs
  ont leur code court ; le contrat `CTN-00007` porte un code analytique externe.
- Facturation › Suivi analytique : ventes par société, agence, secteur, client, contrat ou affaire, activité, site.

Remettre les données à zéro sans arrêter la démo : `npm run demo:donnees` dans un second terminal.

## Extraction des tables

```bash
npm run demo:extraction     # → demo-extraction.xlsx (pip install --user openpyxl si besoin)
```

Un onglet **Sommaire** (composant, rôle, nombre de lignes, lien vers l'onglet), puis un onglet par collection Firestore,
les lignes de facture détaillées et la liste des fichiers déposés. Une ligne par enregistrement, une colonne par champ
(objets imbriqués en « parent.enfant », listes en JSON).

## Fonctionnement

- `scripts/demo/relais.mjs` (port 3100) : une seule adresse pour le navigateur ; les appels du SDK Firebase sont renvoyés
  vers l'émulateur concerné, le reste vers l'application (port 3101). L'aperçu Cloud Shell n'expose en effet qu'une
  adresse https par port.
- `FIREBASE_WEB_EMULATOR_HOST=same-origin` : le navigateur joint les émulateurs par l'adresse de la page
  (`src/lib/firebase.ts`).
- La configuration web Firebase n'est **pas** intégrée au build de démo (servie par `/api/firebase-config`), sinon le
  navigateur pourrait démarrer sans le mode émulateur.
- Garde-fous : le jeu de données et l'extraction refusent de tourner hors émulateurs ou sur un projet qui ne commence pas
  par `demo-`.
