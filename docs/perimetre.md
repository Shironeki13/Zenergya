# Périmètre et modules des utilisateurs

Chaque utilisateur (Utilisateurs › fiche) a :

- un **périmètre** : les sociétés, agences et secteurs qu'il peut voir et modifier (« Toutes » = pas de limite sur cet
  axe). Les trois axes se cumulent : il faut que la société, l'agence **et** le secteur soient dans son périmètre ;
- des **modules** : les parties de l'application auxquelles il accède.

Un **administrateur** voit tout et accède à tout. Les autres droits (contrathèque, achats) ne donnent pas un périmètre
plus large : une contrathèque limitée à une agence ne valide que les documents de cette agence.

## Le périmètre d'un objet est celui de son client

| Objet | Rattaché au client par |
|---|---|
| Contrat, facture, avoir, contact, devis, affaire | son client |
| Site | son client (à défaut, son contrat) |
| Prestation | son contrat (à défaut, son site) |
| Compteur, relevé | son site |
| Situation de travaux | son affaire |
| Commande, heures | l'affaire ou le contrat de chaque ligne |

Un client sans société, agence ou secteur renseigné n'est visible que des utilisateurs dont l'axe correspondant est
« Toutes ».

**Commandes** : en plus, chacun voit les commandes dont il est le demandeur ou un valideur désigné (N+1, N+2).
**Heures** : en plus, chacun voit les siennes et celles de son équipe directe.

## Modules

| Module | Ouvre |
|---|---|
| Clients et contrats | clients, contrats, sites, contrathèque, validation des documents |
| Facturation et compteurs | facturation, factures, avoirs, P1, analytique, indices, compteurs |
| Travaux | devis, affaires, heures, bibliothèque de prix |
| Achats | commandes |
| Paramétrage et imports | paramétrage, imports |

Le tableau de bord et le suivi de facturation sont ouverts à tous (leurs données restent filtrées par le périmètre).
Utilisateurs et clés API : administrateur seulement. Une page hors de ses modules affiche « Accès non autorisé ».

> Les utilisateurs existants n'ont que les modules cochés jusqu'ici : **Travaux, Achats et Paramétrage sont à cocher**
> sur leur fiche pour qu'ils conservent l'accès à ces écrans.

## Où c'est appliqué

1. **Chargement des données** (`DataProvider`) : clients, contrats, sites, prestations, compteurs, relevés, factures,
   avoirs et contacts sont filtrés une fois pour tous les écrans. Les référentiels (agences, activités…) ne le sont pas.
2. **Fiches** ouvertes par leur adresse (client, contrat, facture, devis, affaire) : « Hors de votre périmètre ».
3. **Listes qui lisent leurs propres données** : devis, affaires, sélecteur d'affectation des commandes et des heures.
4. **Serveur** (`src/lib/auth/perimetre-server.ts`) : chaque action vérifie l'objet sur lequel elle porte (devis,
   affaires, situations, paramétrage P1, relevés, régularisations, facturation, facturation électronique, analytique,
   validation des documents, création de contrat, commandes, heures, PDF des factures, avoirs et devis) ; les listes
   calculées au serveur (suivi de facturation, alertes compteurs, facturation groupée, suivi analytique, rentabilité)
   sont filtrées.
5. **Imports en masse** : réservés aux administrateurs.

## Limite actuelle (palier 2)

Le cloisonnement est appliqué par l'application et par le serveur, **pas encore par les règles Firestore** : les
lectures et écritures que le navigateur fait directement dans la base (création ou modification d'un client, d'un
site, d'une prestation…) ne sont pas contrôlées par périmètre. Un utilisateur techniquement averti pourrait donc lire
ou modifier d'autres périmètres avec son propre compte. Le palier 2 inscrit société, agence et secteur sur chaque
document et les fait vérifier par les règles.

Code : `src/lib/perimetre.ts` (règles, pures), `src/lib/auth/perimetre-server.ts`, `src/lib/auth/perimetre-cibles.ts`,
`src/components/perimetre/acces.tsx`. Tests : `tests/perimetre.test.ts`, `tests/perimetre-flow.test.ts`.
