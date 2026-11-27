# Propositions de création (lecture des documents par l'IA)

**Clients et contrats › Propositions (IA)**. On dépose un ou plusieurs contrats (PDF) ; l'IA lit chacun et en tire une
**proposition** : client, contrat, sites, prestations. **Rien n'est créé** tant qu'une personne de la contrathèque (ou un
administrateur) ne l'a pas vérifiée et acceptée.

## Parcours

1. **Dépôt** (module Contrats) : type de marché (privé, public), un ou plusieurs PDF (20 Mo au plus). Le document est
   enregistré (`propositions/<id>/` dans le stockage), puis lu. Statut « À revoir », ou « Lecture impossible » avec le
   motif (clé IA absente, document illisible…) ; « Relire » relance la lecture.
2. **Revue** (fiche de la proposition) : le document à gauche ; à droite ce qui a été lu, marqué « lu », avec pour
   chaque information l'**extrait du document** d'où elle vient, sa page et la confiance de l'IA (haute, moyenne,
   basse). En tête, les **points à vérifier** :
   - client reconnu (même SIRET ou même nom) : il ne sera pas recréé ; client ressemblant à un client existant ;
   - client reconnu ayant déjà un **contrat actif sur une période qui se recouvre** (avenant ou doublon ?) ;
   - site du document qui **existe déjà** chez le client : repris tel quel ; déjà sous un autre contrat : signalé ;
   - montant lu pour le contrat entier alors qu'il y a plusieurs sites : porté sur le premier, **à répartir** ;
   - informations manquantes pour créer (société, agence, secteur, responsable de facturation, TVA…).
3. **Décision** (contrathèque, administrateurs) :
   - **Vérifier et créer** : l'assistant de création s'ouvre pré-rempli (toutes les étapes modifiables) ; à la
     création, client, contrat, sites et prestations sont créés comme d'habitude — le contrat en « Brouillon », en
     attente de validation — le document lu lui est joint, et la proposition passe « Acceptée » avec le contrat ;
   - **Refuser** avec un motif : rien n'est créé, la trace reste.

Une proposition est visible par son déposant, la contrathèque, les administrateurs, et qui voit le client reconnu.

## Ce que l'IA lit

Client (nom, adresse, SIRET, représentant, contact de facturation, typologie), contrat (libellé, dates, reconduction,
préavis, facturation globale ou par site), sites, prestations (activité, montant annuel HT, périodicité, terme ; TVA de
l'activité). Elle cite l'extrait de chaque information et ne doit rien inventer (champ vide plutôt que deviné).
Non repris à ce stade : révision (règle, indices de base), paramétrage P1, ventilation de TVA, contacts techniques
(lot suivant).

## Réglages

- `GEMINI_API_KEY`, `GEMINI_MODELE` : voir `src/ai/modeles.ts`.
- `IA_SIMULATION=1` (**démo et essais seulement**) : lecture fictive sans appel au fournisseur (une copropriété
  « Les Érables » ; un fichier dont le nom contient « tilleuls » donne le client existant Les Tilleuls). Les
  propositions concernées portent « lecture simulée (démo) ».
- Confidentialité : les documents sont envoyés au fournisseur de l'IA pour être lus. Pour des contrats clients,
  préférer Vertex AI dans le projet Google Cloud de l'entreprise (région européenne) — à valider avec la DSI.

Code : `src/lib/contracts/propositions.ts` (logique pure), `src/ai/lecture-contrat.ts`, `src/services/propositions-admin.ts`,
`src/app/api/propositions/route.ts`, écrans `src/app/(app)/contracts/propositions/`.
