# Ergonomie : composants communs

Règles et composants à réutiliser sur tout nouvel écran (lots 1 et 2 de la refonte de l'interface).

## Navigation

- **Menu par métier** : `src/components/navigation/nav-config.ts` est la seule source des rubriques (Pilotage, Clients
  et contrats, Facturation, Compteurs et énergie, Travaux, Administration). Une nouvelle page s'y ajoute (libellé,
  icône, mots-clés de recherche, `admin` si réservée) : menu, fil d'Ariane et recherche globale la prennent en compte.
- **Entrée active** : la plus précise dont l'adresse est un préfixe ; les fiches et sous-pages surlignent leur liste.
  Les rubriques ouvertes à la main sont mémorisées dans le navigateur.
- **Fil d'Ariane** (`breadcrumbs.tsx`) : rubrique › page › nom de l'élément (client, contrat, site, facture) ›
  sous-page (`SOUS_PAGES` pour les libellés : « Modifier », « Nouveau »…).
- **Recherche globale** (`global-search.tsx`, Ctrl+K) : pages, clients, contrats, sites, compteurs, factures ; nom,
  code, réf. externe, SIRET, PDL/PCE, ville ; accents et casse ignorés. Une page qui reçoit `?q=` peut le recopier
  dans son filtre avec `<SearchParamSync name="q" onValue={setRecherche} />` (cas des compteurs).
- **Titres de page** : `<h1 className="text-2xl font-bold tracking-tight">`.

## Saisie

- **Confirmation et saisie** : jamais `window.confirm` ni `window.prompt`.
  ```tsx
  const confirmer = useConfirm();
  if (!(await confirmer({ title: 'Supprimer ce relevé ?', confirmLabel: 'Supprimer', destructive: true }))) return;
  const demander = usePrompt();
  const motif = await demander({ title: 'Retirer la version', label: 'Motif du retrait', required: true, multiline: true });
  ```
- **Longues listes** (clients, sites, contrats, indices, stations, relevés…) : `SearchableSelect`
  (`src/components/ui/searchable-select.tsx`) plutôt que `Select` au-delà d'une dizaine de choix. Options toutes
  faites : `optionsClients`, `optionsSites` (`src/lib/select-options.ts`). Utilisable dans un `FormControl` et dans
  une fenêtre (la liste s'affiche alors dans la fenêtre).
- **Champs obligatoires** : `<Form {...form} schema={MonSchema}>` ; chaque `FormLabel` d'un champ obligatoire
  d'après le schéma porte un astérisque rouge (pas sur les libellés d'options `font-normal`, ni en double si le texte
  en a déjà un ; forçable par `required`). Règle : ni optionnel, ni nullable, ni valeur par défaut ; texte avec longueur
  minimale, format ou message « requis » propre ; nombre, date, liste.
- **Erreurs à l'envoi** : `form.handleSubmit(onSubmit, signalerErreurs)` : message « N champs à corriger » avec la
  liste, défilement jusqu'au premier, champs d'un autre onglet comptés à part.
- **Messages de validation en français** pour les cas sans message propre (`src/lib/forms/zod-fr.ts`, chargé par le
  composant `Form`).
- **Modifications non enregistrées** : `useAlerteModifications(form.formState.isDirty && !form.formState.isSubmitSuccessful)`
  sur les formulaires pleine page : alerte à la fermeture de l'onglet et au clic sur un lien de l'application.

## Listes : le tableau commun

`src/components/data-table/data-table.tsx` (logique pure testée : `logique.ts`, `tests/data-table.test.ts`), utilisé
par les listes Clients, Contrats, Sites, Compteurs, Factures et Avoirs :

- **Recherche** sur plusieurs champs (mots, accents et casse ignorés) ; `parametreUrl: 'q'` reprend la recherche
  passée dans l'adresse (recherche globale → compteurs, sites).
- **Filtres** à choix multiples avec **effectifs** (« Actif (12) », calculés avec les autres filtres), puces des
  filtres actifs, « Tout effacer ». Options fixes ou déduites des lignes ; « Non renseigné » pour les valeurs vides.
- **Tri** par clic sur l'en-tête (croissant, décroissant, aucun) : texte à la française avec les nombres dans l'ordre
  (« Pins 2 » avant « Pins 10 »), nombres, dates ; valeurs vides toujours en dernier.
- **Pagination** 25 / 50 / 100 ; **choix des colonnes** (colonnes `masquee` ajoutables, `fixe` toujours visibles) ;
  colonnes, tri et taille de page **mémorisés** par liste dans le navigateur.
- **Export CSV** des lignes filtrées (colonnes avec `exporter`, toutes, affichées ou non).
- **Lignes cliquables** (`lien`, Ctrl/⌘ + clic : nouvel onglet ; les liens, boutons et cases de la ligne gardent leur
  action) ; **actions** par ligne ; **sélection** et **actions groupées** (`selection.possible`, `selection.actions`).
- Chargement en blocs gris ; liste vide : message et action utiles, ou « aucun résultat pour ces critères » avec
  « Effacer la recherche et les filtres ».

Changements de fond : la liste des **contrats** n'impose plus de choisir société › agence › secteur (filtres, dans le
périmètre de l'utilisateur) ; **factures** : « Marquer comme payée » fonctionne, « Envoyer un rappel » (sans effet) est
retiré, l'annulation par avoir **demande le motif** (il figure sur l'avoir) ; **compteurs** : dernier relevé et
filtre « sans relevé depuis 45 jours » ; **sites** : montant annuel et état des prestations.

## Fiches : le modèle de la fiche site

`src/app/(app)/sites/[id]/page.tsx`, briques dans `src/components/sites/fiche-site.tsx` :

- **Bandeau** : nom, code, état du contrat, client › contrat, adresse ; actions (modifier le site, devis).
- **Indicateurs** cliquables : montant annuel HT (prestations en vigueur), prestations (incomplètes), compteurs (sans
  relevé depuis 45 jours), échéances facturables non facturées (même échéancier que la facture).
- **Onglets**, conservés dans l'adresse (`?onglet=synthese|prestations|compteurs|p1|factures`) :
  - *Synthèse* : informations, encart **À faire** (sans contrat, aucune prestation, prestation incomplète — TVA,
    périodicité, terme, montant —, paramétrage P1 incomplet, échéances en retard, compteurs sans relevé), chacun avec
    son action ; tableau des prestations ;
  - *Prestations* : liste par P1 / P2 / P3 (ajout par type) et détail (montant, période, état ; blocs propres au P1 —
    énergie, compteurs associés, aperçu de calcul, décomptes — seulement pour le P1), paramètres de facturation et
    calendrier ;
  - *Compteurs et relevés* : dernier relevé, relevés, paramétrage P1 du compteur, modification ;
  - *Paramétrage P1* ; *Factures* : factures du contrat qui portent des lignes du site (montant HT du site).

Briques communes : `src/components/fiches/fiche.tsx` (`Indicateur`, `AFaire` et `CompteurAFaire` — rouge s'il y a un
point bloquant, orange sinon —, `useOngletUrl`, `StatutFacture`) et `src/components/fiches/tableaux.tsx` (sites, factures,
contrats, contacts). Échéances non facturées : `src/lib/billing/echeances-fiche.ts` (même échéancier que la facture).

- **Fiche contrat** (`/contracts/[id]`) : bandeau (n°, libellé, statut modifiable, client, période, sites, mode de
  facturation ; Modifier, Générer une facture) ; indicateurs (montant annuel HT, facturé TTC hors proformas et
  annulées, solde dû, échéances à facturer) ; onglets Synthèse (à faire, informations, responsable facturation,
  contacts), Sites, Factures, Facturation électronique, Paramétrage P1 (contrat P1), Historique (avenants,
  résiliations, reconductions, changements de syndic et de BE). À faire : refus ou attente de validation, aucun site,
  sites sans prestation, prestations incomplètes, échéances en retard, impayés, aucun responsable facturation, aucun
  contact de facturation, échéance du contrat sous 90 jours.
- **Fiche client** (`/clients/[id]`) : bandeau (nom, code, prospect, public / privé, adresse, société › agence ;
  Modifier, devis, Nouveau contrat) ; indicateurs (contrats actifs, sites, montant annuel HT, solde dû) ; onglets
  Synthèse (à faire, informations, contrôle du SIRET, contacts), Contrats (montant, responsable facturation), Sites,
  Factures. À faire : client public sans SIRET, SIRET introuvable ou établissement fermé, contact de facturation absent
  ou sans e-mail, impayés, sites sans prestation, contrats sans responsable, contrats à échéance sous 90 jours.

## Vérification

`npm test` (`tests/ux.test.ts`) : entrée de menu active, droits, champs obligatoires déduits des schémas, messages.
Parcours vérifiés dans un navigateur (émulateurs, build de production) : connexion, menu et fil d'Ariane, Ctrl+K,
liste avec recherche dans une fenêtre, confirmation, astérisques, récapitulatif d'erreurs, alerte en quittant ; fiche
site (synthèse, à faire, onglets, lien direct `?onglet=`, compléter une prestation, factures, modification du site) ;
fiches contrat et client (synthèse, à faire, onglets, ajout d'un site) ; listes (pagination, recherche, filtres,
tri, colonnes et préférences mémorisées, ouverture d'une fiche, avoir avec motif, facture marquée payée).
