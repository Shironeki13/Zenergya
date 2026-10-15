# Facturation électronique (RFE)

> Synthèse fonctionnelle de ce que fait l'application. Le calendrier et le périmètre de la réforme
> sont à confirmer avec votre expert-comptable et votre plateforme agréée : ils ont déjà évolué plusieurs fois.

## Principe

Selon le client, une facture (ou un avoir) suit l'un de ces canaux :

| Régime | Clients concernés | Canal | Dans le tableau de bord |
| --- | --- | --- | --- |
| **B2B** | Entreprises assujetties établies en France | Plateforme agréée (facture électronique) | À transmettre |
| **B2G** | Entités publiques | Chorus Pro | À transmettre |
| **B2C** | Particuliers, non-assujettis (ex. syndicats de copropriétaires non assujettis) | E-reporting : pas de facture électronique | Non concernée |
| **International** | Clients établis hors de France | E-reporting | Non concernée |
| **Hors champ** | Cas particuliers | Aucune transmission | Non concernée |

## Paramétrage

Le régime d'un client est déterminé dans cet ordre (`src/lib/einvoicing.ts`) :

1. **Fiche client → Facturation électronique → Régime**, s'il n'est pas sur « Automatique » ;
2. **client public** (Privé / Public) → B2G ;
3. **régime de la typologie** (*Paramétrage → Typologies*, ex. Particulier → B2C) ;
4. sinon **B2B**.

**Adresse électronique de facturation** (B2B), dans cet ordre :

1. **contrat** (fiche contrat → carte « Facturation électronique ») : pour un service, un site ou un code de routage propre ;
2. **client** (fiche client) : adresse principale ;
3. à défaut, **SIREN du client** (déduit du SIRET), qui est l'adressage par défaut de l'annuaire.

Format accepté : `SIREN`, `SIREN_SIRET`, `SIREN_SIRET_CODE` ou `SIREN_SUFFIXE`.
L'adresse doit correspondre à celle que le client a déclarée dans l'annuaire : à vérifier avec lui ou via votre plateforme.

**Société émettrice → « Facturation électronique obligatoire à partir du »** : les factures B2B antérieures à cette date
sont « non concernées ». Sans date, toutes les factures B2B sont considérées comme à transmettre (un bandeau le signale).

## À l'émission

L'état de transmission est **figé sur la facture / l'avoir** (champ `einvoicing`) : régime, canal, adresse utilisée et sa
provenance, anomalies bloquantes ou non, statut initial (`to_send` ou `not_applicable`). Les proformas n'en ont pas.

Les documents émis avant cette fonctionnalité sont calculés à l'affichage (« calculé (antérieur) ») puis figés au premier
recalcul ou changement de statut.

## Tableau de bord (Facturation → Facturation électronique)

- **Indicateurs** : à transmettre, bloquées (adressage incomplet), rejetées, transmises, non concernées (nombre et montant TTC).
- **Filtres** : société, canal, statut, période, recherche.
- **Actions groupées** :
  - *Marquer transmises* (référence de dépôt facultative) ;
  - *Marquer rejetées* (motif) ;
  - *Remettre à transmettre* ;
  - *Recalculer l'adressage* après correction d'une fiche client ou d'un contrat (impossible une fois transmis) ;
  - *Exporter CSV* (sélection ou liste filtrée) pour le dépôt sur la plateforme.
- **Clients à compléter** : clients dont le paramétrage bloque (adresse / SIRET manquant) ou fragilise la transmission
  (SIRET invalide, adresse incohérente avec le SIREN, Chorus non activé).

Transitions de statut autorisées : à transmettre → transmise / rejetée ; rejetée → à transmettre / transmise ;
transmise → rejetée. Chaque changement enregistre son auteur et sa date.

## Limites actuelles

- **Pas de connexion directe à une plateforme agréée** : la transmission se fait par export puis dépôt, et les statuts sont
  mis à jour à la main. Une intégration API sera possible une fois la plateforme choisie (dépôt automatique, retour des
  statuts du cycle de vie).
- **Format** : le PDF archivé n'est pas un Factur-X. Les plateformes acceptent en général un PDF accompagné des données,
  ou génèrent elles-mêmes le format structuré : à confirmer avec la vôtre.
- **E-reporting** : les documents concernés sont identifiés, mais l'export des données de transaction n'est pas encore produit.
- **Nouvelles mentions obligatoires** (SIREN du client, adresse de livraison, nature des opérations, option TVA sur les débits) :
  à ajouter au modèle de facture après validation par votre expert-comptable.
