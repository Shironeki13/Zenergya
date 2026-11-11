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

1. **Chargement des données** : clients, contrats, sites, prestations, compteurs, relevés, factures, avoirs et contacts
   sont lus par le serveur (`/api/donnees`, `src/services/donnees-admin.ts`), qui ne renvoie au navigateur que le
   périmètre de l'utilisateur. Le `DataProvider` refiltre côté navigateur (utile à l'affichage « en tant que »). Les
   référentiels (agences, activités…) sont lus directement et ne sont pas filtrés.
2. **Fiches et éléments d'un objet** (client, contrat et ses événements, facture, devis et ses versions, affaire et ses
   situations, intéressements d'une prestation…) : lus par le serveur par des **lectures nommées** (`/api/lecture`,
   `src/services/lectures-admin.ts`) qui contrôlent le client de l'objet demandé. Un objet hors périmètre est refusé et
   l'écran affiche « Hors de votre périmètre » ; les listes de devis et d'affaires sont réduites au périmètre.
3. **Écritures** sur clients, contrats, sites, compteurs, prestations, intéressements, documents de contrat, statut des
   factures et devis en brouillon : exécutées par le serveur par des **écritures nommées** (`/api/ecriture`,
   `src/services/ecritures-admin.ts`). Chacune contrôle le périmètre avant d'agir, ainsi que les garde-fous qui étaient
   portés par les règles Firestore (codes immuables, validation des contrats réservée à la contrathèque, statut
   d'encaissement des factures, documents de contrat créés « en attente » avec leur pièce, devis envoyés non
   modifiables). La logique (numérotation, cascades) est celle d'avant, exécutée par le serveur
   (`src/lib/firestore-compat-admin.ts`).
4. **Actions serveur** (`src/lib/auth/perimetre-server.ts`) : chaque action vérifie l'objet sur lequel elle porte (devis,
   affaires, situations, paramétrage P1, relevés, régularisations, facturation, facturation électronique, analytique,
   validation des documents, création de contrat, commandes, heures, PDF des factures, avoirs et devis) ; les listes
   calculées au serveur (suivi de facturation, alertes compteurs, facturation groupée, suivi analytique, rentabilité)
   sont filtrées.
5. **Imports en masse** : réservés aux administrateurs.

## Accès direct fermé (règles Firestore et Storage)

Le navigateur n'accède directement qu'aux **référentiels** : lecture pour tous les utilisateurs, écriture avec le module
Paramétrage (droit `param`, posé à la connexion) ; utilisateurs et rôles : écriture par l'administrateur. Toutes les
autres collections — et le stockage des fichiers — sont **fermées au navigateur**, administrateur compris : elles ne
sont lues et écrites que par le serveur, qui applique le périmètre. Les règles sont une liste blanche : une collection
qui n'y figure pas est refusée.

- **Pièces justificatives** : déposées par le serveur (`/api/pieces`), qui contrôle le périmètre, le type (PDF, PNG,
  JPEG) et la taille (20 Mo) ; consultées par leur adresse de téléchargement à jeton.
- **Mise en service** : déployer l'application **avant** les règles (l'ancienne version de l'application lit la base
  directement et serait bloquée), puis faire se reconnecter les utilisateurs (leurs droits sont posés à la connexion).

## Limites connues

- Une pièce justificative se consulte par une **adresse à jeton** : quiconque détient l'adresse peut ouvrir le fichier.
  Le serveur ne la communique qu'avec les documents du périmètre de l'utilisateur, mais elle reste valable si elle est
  transmise à un tiers.
- La **bibliothèque de prix** et les compteurs de numérotation (`config`) restent modifiables par tout utilisateur de
  l'application, comme avant.
- Les **référentiels** (dont la liste des utilisateurs et leurs périmètres) sont lisibles par tous les utilisateurs.

Code : `src/lib/perimetre.ts` (règles, pures), `src/lib/auth/perimetre-server.ts`, `src/lib/auth/perimetre-cibles.ts`,
`src/components/perimetre/acces.tsx`, `src/services/donnees-admin.ts`, `src/services/lectures-admin.ts`,
`src/services/ecritures-admin.ts`, `src/app/api/pieces/route.ts`, `firestore.rules`, `storage.rules`. Tests :
`tests/perimetre.test.ts`, `tests/perimetre-flow.test.ts`, `tests/donnees-flow.test.ts`, `tests/lectures-flow.test.ts`,
`tests/ecritures-flow.test.ts`, `tests/firestore-rules.test.mjs`.
