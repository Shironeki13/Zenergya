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
| Ouvrage (bibliothèque) | somme de ses composants, chacun selon sa nature | somme des déboursés des composants |
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

## Cycle de vie

```
brouillon ──Envoyer──▶ envoyé ──▶ accepté
    ▲                    │  ├──▶ refusé
    └──Nouvelle version──┘  └──▶ expiré (validité dépassée : déduit de la date, rien à lancer)
brouillon / envoyé ──Annuler (motif)──▶ annulé
```

| Action | Effet |
| --- | --- |
| **Envoyer** | Exige un brouillon enregistré et complet. Le devis prend la **date du jour** (la validité court à partir de là), passe « envoyé » et est **figé** : PDF généré une fois, archivé dans Cloud Storage sans écrasement possible (`archives/{société}/quotes/{année}/{numéro}-V{version}.pdf`), empreinte SHA-256 vérifiée à chaque téléchargement, copie complète du devis dans `quoteVersions` |
| **Accepté** | Date de l'accord, signataire et qualité, n° de bon de commande, commentaire. Le **prospect devient client** ; sur demande, le **site est créé** depuis l'adresse d'intervention (code `SIT` attribué). Un devis expiré ne s'accepte qu'avec une confirmation explicite |
| **Refusé** | Date et motif (obligatoire) |
| **Nouvelle version** | Depuis un devis envoyé, expiré ou refusé : la version envoyée reste archivée (PDF consultable), le devis redevient un brouillon modifiable sous le **même numéro**, version + 1 |
| **Annuler** | Motif obligatoire ; le devis reste consultable avec ses versions |

Un brouillon jamais envoyé (version 1) peut être supprimé ; au-delà, il s'annule.

**Sécurité** : le navigateur ne modifie qu'un brouillon, qui reste un brouillon (même numéro, même version). Toutes les
transitions passent par le serveur (`src/services/quotes-admin.ts`, actions `src/lib/quotes/actions.ts`, session
requise) ; `quoteVersions` n'est écrit que par le serveur.

## PDF

`/api/quotes/{id}/pdf` (session requise) : la version envoyée archivée, ou l'**aperçu** d'un brouillon (marqué
« APERÇU — DEVIS NON ENVOYÉ », jamais archivé). `?version=N` pour une version précédente.

Le PDF ne montre que les prix (ni déboursé, ni coefficient, ni marge) et porte : identification de la société (SIRET,
TVA) et du client, date, fin de validité, référence et date de la demande du client, interlocuteur, rédacteur, objet,
lieu d'intervention, lignes (titres et sous-totaux avec leur montant, remises), totaux HT / TVA par taux / TTC,
options à part, début et durée estimés, conditions de paiement, « devis gratuit », conditions particulières,
**assurance professionnelle** (assureur, n° de contrat, couverture géographique — Paramétrage → Sociétés),
mentions complémentaires de la société, et le cadre « Bon pour accord — devis reçu avant l'exécution des travaux ».
Liste à faire valider par le service juridique.

## Facturation d'un devis accepté

Carte **Facturation** d'un devis accepté : factures émises, montant facturé et reste à facturer.

| Facture | Contenu |
| --- | --- |
| **Totalité** | Le détail du devis (lignes chiffrées, options exclues), TVA par taux |
| **Acompte** | Un pourcentage du devis, ventilé sur chacun de ses taux de TVA (une ligne par taux). Les acomptes cumulés restent sous 100 % : il reste toujours un solde |
| **Solde** | Le détail du devis, moins chaque acompte déjà facturé (une ligne de déduction par acompte et par taux) |

- **Numéro légal** de la série habituelle des factures, attribué dans la même transaction que la relecture du devis
  et de ses factures : deux facturations simultanées ne peuvent pas facturer deux fois.
- La TVA du solde est calculée **par différence** (TVA du devis − TVA des acomptes), taux par taux : la somme des
  factures d'un devis égale exactement ses totaux, au centime.
- Circuit habituel ensuite : PDF archivé (« FACTURE D'ACOMPTE » pour un acompte ; références du devis et du bon de
  commande), facturation électronique ; pour un client public, le **bon de commande** saisi à l'acceptation est
  l'engagement juridique déposé sur Chorus Pro.
- Une facture se corrige par un **avoir** : une facture annulée par avoir ne compte plus, et peut être réémise.
  L'avoir d'un solde reprend exactement ses montants (les déductions d'acompte y redeviennent positives).
- Échéance : 30 jours.

## À venir

Envoi par email depuis l'application, signature électronique. Les articles et ouvrages réutilisables sont dans la
[bibliothèque de prix](bibliotheque-prix.md) ; les devis P6 se facturent à l'avancement : voir
[affaires-p6.md](affaires-p6.md).
