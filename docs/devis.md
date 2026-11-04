# Devis

Menu **Travaux → Devis**, ou depuis une fiche site / une fiche client (« Nouveau devis »).

## Principes

- **Client ou prospect.** Un devis porte sur une fiche client. Pour un nouveau client, « Nouveau prospect » crée une
  fiche marquée *Prospect* (recherche possible dans le répertoire des entreprises) : pas de double saisie, et elle
  deviendra *Client* à l'acceptation du devis.
- **Site et contrat facultatifs.** Le devis porte sur un site existant du client, ou sur une **adresse d'intervention**
  (un site pourra être créé à l'acceptation). Un devis sur site reprend le contrat du site.
- **Chiffrage interne et prix client séparés.** Chaque ligne porte un déboursé (coût) ; le prix de vente en découle.
  Le client ne voit que les prix ; l'équipe voit la marge.
- **Conditions de prix par client.** Coefficient de vente et taux horaire de main-d'œuvre : fiche client, sinon
  société (Paramétrage → Sociétés, avec le coût horaire interne, la validité et la TVA par défaut). Elles sont
  **recopiées sur le devis à sa création** : les modifier ensuite ne change pas les devis existants. Un paramètre
  absent n'est jamais remplacé par une valeur inventée : la ligne est « non calculable » et l'envoi le signale.
- **Un devis envoyé est figé.** Seul un brouillon se modifie ou se supprime (règles Firestore) ; un devis envoyé
  s'annule ou passe par une nouvelle version.

## Suivi

| Champ | Rôle |
| --- | --- |
| Rédacteur du devis | Utilisateur responsable (chargé d'affaires) : par défaut celui qui crée le devis, modifiable. Nom et email recopiés sur le devis. Filtre « Mes devis » dans la liste |
| Agence, secteur | Analytique et périmètre, repris du client à la création |
| Interlocuteur chez le client | Contact destinataire, choisi parmi les contacts du client ; nom, email et téléphone recopiés |
| Référence du client | N° de consultation, de demande… |
| Date de la demande | Pour suivre le délai de réponse |

Création et dernière modification sont aussi tracées (date et utilisateur).

## Lignes

| Nature | Prix unitaire de vente | Coût |
| --- | --- | --- |
| Fourniture, sous-traitance, divers | déboursé × coefficient (de la ligne, sinon du devis) | déboursé |
| Main-d'œuvre (en heures) | taux horaire facturé du devis | coût horaire interne (ou déboursé saisi) |
| Titre, sous-total, texte | — (un titre ou un sous-total affiche la somme de ses lignes) | — |

Un **prix unitaire saisi** remplace le calcul. Remise par ligne, **TVA par ligne** (20 %, 10 %, 5,5 %…). Une ligne
**en option** est affichée mais n'entre pas dans les totaux.

Montants arrondis au centime ligne par ligne ; TVA calculée par taux sur la somme des lignes de ce taux ; totaux
**recalculés à chaque enregistrement** à partir des lignes (jamais repris de l'écran).

Indicateurs internes : déboursé, marge et taux de marge (sur le prix de vente), coefficient effectif, heures de
main-d'œuvre.

## Numérotation

`{CODE}-DEV{AAAA}-{NNNN}` (ex. `VEF-DEV2026-0001`) : série par société et par année, numéro attribué à la création
dans la même transaction que l'écriture (pas de doublon). Le code de la société est obligatoire.

## Statuts

brouillon → envoyé → accepté / refusé / expiré, ou annulé. Ce lot couvre le **brouillon** ; l'envoi (PDF avec les
mentions obligatoires, archivé), les versions, l'acceptation (signataire, bon de commande, prospect → client, création
du site) et la transformation en facture (P5) ou en affaire (P6) viennent dans les lots suivants.
