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
| `adv2@example.com` | ADV (Julien Petit) | second portefeuille (pilotage par responsable facturation) |
| `contratheque@example.com` | Contrathèque | validation des documents : contrôle champ par champ, corrections, refus |
| `admin@example.com` | Administrateur, sans le droit contrathèque | utilisateurs et rôles ; ne voit pas la validation |

## Contenu du jeu de données

Créé par `scripts/demo/donnees.ts` au travers du moteur d'import et du moteur de facturation de l'application (codes,
liens et montants sont donc ceux que l'application produirait) :

- référentiels : une société, 2 agences, 3 secteurs, typologies, activités P1 / P2 / P3, TVA, périodicités, termes,
  conditions de paiement, types de compteurs, un marché ;
- 12 clients (copropriétés avec syndic, bailleur, collectivités avec SIRET fictif, tertiaire, un prospect) et 22 contacts
  (deux clients sans contact de facturation) ;
- 13 contrats (actifs, un terminé), 18 sites, 31 prestations, 19 compteurs, 225 relevés mensuels (un mois manquant sur
  quelques compteurs, des relevés estimés) ;
- 27 factures émises par le moteur (avril, juillet, octobre 2026), payées, dues ou en retard ;
- à valider par la contrathèque : 3 contrats de base marché (avec PDF, sans PDF, refusé), 2 avenants dont un **mal
  saisi** (nouvelle fin 30/06/2029 au lieu du 30/06/2030 du PDF : à corriger au contrôle), un OS, une reconduction, une
  résiliation, un changement de syndic, un changement de BE ; plus un historique déjà validé ou refusé ;
- des pièces PDF fictives pour chacun de ces documents.

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
