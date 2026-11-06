/**
 * Consignes d'analyse des contrats PDF (lecture par l'IA), reprises des anciens formulaires « Marché privé » et
 * « Marché public ». Modifiables à l'étape « Source » de l'assistant de création.
 */

export const PROMPT_MARCHE_PRIVE = `Agis comme un expert en saisie de données juridiques. Analyse ce contrat et extrais les données pour remplir la base de données.

**Instructions Logiques pour le CLIENT :**
1.  **Identification du Client (\`name\`)** : C'est l'entité bénéficiaire du service (ex: "Copropriété Le Bastion", "Mairie de...", "Société X"). Ce N'EST PAS le représentant (Syndic) sauf si le contrat est directement au nom du Syndic pour ses propres bureaux.
2.  **Représentant** : Si le client est une Copropriété, identifie le Syndic (mention "Représenté par").
3.  **Typologie (\`typologyName\`)** : Déduis-la du contexte :
    - "Copropriété" (si mention de syndic, résidence, SDC).
    - "Tertiaire" (Bureaux, Commerces, SA, SAS).
    - "Collectivité" (Mairie, Ecole, Public).
    - "Industrie" (Usine, Site de production).
4.  **Chorus (\`useChorus\`)** : Mets \`true\` UNIQUEMENT si le client est une entité publique (Mairie, Collectivité, État). Sinon \`false\`.
5.  **Adresses** : L'\`address\` principale doit être le lieu d'exécution du contrat (l'adresse de l'immeuble chauffé).
6.  **Contacts** : Identifie et extrais les contacts mentionnés dans le contrat :
    - **Contact Technique** (\`contactTechnique\`) : La personne à contacter pour les aspects techniques (gardien, gestionnaire technique, responsable technique, syndic opérationnel...). Extrais son nom, email, téléphone, et son rôle/fonction (ex: "Gardien", "Gestionnaire", "Responsable Technique").
    - **Contact Facturation** (\`contactFacturation\`) : La personne ou service à contacter pour la facturation (comptable, service comptabilité, ordonnateur, trésorier...). Extrais son nom, email, téléphone, et son rôle/fonction (ex: "Comptable", "Service Facturation", "Gestionnaire").
    - Si un seul contact est mentionné, utilise-le pour les deux.
    - Si aucun contact explicite n'est mentionné mais qu'un représentant (Syndic) est identifié, utilise-le comme contact technique avec le rôle "Syndic".

**Instructions Logiques pour le CONTRAT :**
1.  **Nom & Libellé** :
    - \`name\` : "Contrat Maintenance - [Nom Client]" (ex: "Contrat Maintenance - Le Bastion").
    - \`label\` : Type de prestations (ex: "Chauffage & ECS (Type P1 MTI - P2)").
2.  **Dates & Durée** :
    - \`startDate\` : Date d'effet du contrat.
    - \`endDate\` : Date de fin (souvent calculée : date effet + durée).
    - \`durationStr\` : Durée telle qu'écrite dans le contrat (ex: "2 ans", "5 ans").
3.  **Montants (HT/an)** :
    - \`baseAmountP1\` : Montant P1 (Total P1 ou Forfait P1).
    - \`baseAmountP2\` : Montant P2 (Total P2 ou Forfait P2).
    - \`baseAmountP3\` : Montant P3 (Garantie totale).
    - \`baseAmountP3R\` : Montant P3R (Renouvellement).
4.  **Reconduction** :
    - \`tacitRenewal\` : \`true\` si reconduction tacite.
    - \`noticePeriod\` : Préavis de résiliation (ex: "3 mois", "6 mois").

**Instructions Logiques pour les SITES :**
1.  **Identification des sites** : Un contrat peut couvrir un ou plusieurs sites (immeubles, bâtiments, adresses distinctes). Identifie TOUS les sites mentionnés.
2.  **Facturation** (par site) :
    - \`billingSchedule\` : Périodicité de facturation (ex: "Mensuelle", "Trimestrielle", "Annuelle").
    - \`term\` : Terme de facturation (ex: "Échu", "Échoir").
3.  **Révisions de Prix** (par site) :
    - \`revisionP1\` : Formule complète de révision P1.
    - \`revisionP2\` : Formule complète de révision P2.
    - \`revisionP3\` : Formule complète de révision P3.
4.  **Données Techniques P1** (par site) :
    - \`heatingReferenceDju\` : DJU de référence (ex: 1200, 2050).
    - \`heatingWeatherStation\` : Station météo de référence (ex: "Nice", "Le Bourget").
    - \`contractualNB\` : Valeur du NB contractuel.
    - \`smallQ\` : Valeur du petit q.
5.  **Options P1** (par site) :
    - \`hasHeating\` : \`true\` si prestation de chauffage (P1 Chauffage).
    - \`hasECS\` : \`true\` si prestation d'Eau Chaude Sanitaire (P1 ECS).
    - \`hasInterest\` : \`true\` si mention d'intéressement ou de partage d'économies.

**Format de sortie :** Uniquement un JSON valide respectant strictement ce schéma :

{
  "client": {
    "name": "Nom du client final",
    "representativeName": "Nom du représentant/Syndic",
    "address": "Adresse principale",
    "postalCode": "Code postal",
    "city": "Ville",
    "clientType": "private" ou "public",
    "typologyName": "Copropriété, Tertiaire, Industrie ou Collectivité",
    "siret": "SIRET",
    "isBe": false,
    "useChorus": boolean,
    "contactTechnique": { "name": "...", "email": "...", "phone": "...", "role": "..." },
    "contactFacturation": { "name": "...", "email": "...", "phone": "...", "role": "..." }
  },
  "contrat": {
     "name": "Nom du contrat",
     "label": "Libellé",
     "objet": "Objet du contrat",
     "startDate": "YYYY-MM-DD",
     "durationStr": "Durée (ex: 2 ans)",
     "endDate": "YYYY-MM-DD",
     "tacitRenewal": boolean,
     "noticePeriod": "Préavis",
     "baseAmountP1": number,
     "baseAmountP2": number,
     "baseAmountP3": number,
     "baseAmountP3R": number
  },
  "sites": [
    {
      "name": "Nom du site (ex: Résidence Le Bastion)",
      "address": "Adresse du site",
      "postalCode": "Code postal",
      "city": "Ville",
      "billingSchedule": "Périodicité (ex: Mensuel, Trimestriel)",
      "term": "Terme (ex: Échu, Échoir)",
      "revisionP1": "Formule...",
      "revisionP2": "Formule...",
      "revisionP3": "Formule...",
      "heatingReferenceDju": number,
      "heatingWeatherStation": "Station...",
      "hasInterest": boolean,
      "hasHeating": boolean,
      "hasECS": boolean,
      "contractualNB": number,
      "smallQ": number
    }
  ]
}`;

export const PROMPT_MARCHE_PUBLIC = `
Analyse ce contrat de marché public (CCTP, AE ou CCAP) et extrais les informations suivantes au format JSON.
Si une information est introuvable, laisse le champ vide ou null.

**CLIENT :**
- Nom du client (name): Le nom de l'entité publique (ex: "Mairie de...", "Communauté de communes...").
- Adresse (address): L'adresse postale complète du site d'exécution.
- Code postal (postalCode): Le code postal.
- Ville (city): La ville.
- SIRET (siret): Le numéro SIRET du client.
- Type de client (clientType): Toujours "public".
- Contacts : Identifie le contact technique et le contact facturation si mentionnés.

**CONTRAT :**
- Date de démarrage (startDate): La date de début du contrat ou de notification, au format YYYY-MM-DD.
- Date de fin (endDate): La date de fin du contrat, au format YYYY-MM-DD.
- Reconduction (renewal): Indique si le contrat est à reconduction (true ou false), souvent dans le CCAP.
- Durée de la reconduction (renewalDuration): Si la reconduction est activée, précise sa durée (ex: '1 an').
- Tacite reconduction (tacitRenewal): Si la reconduction est activée, indique si elle est tacite (true ou false).
- Code service Chorus (chorusServiceCode): Le code service pour la facturation Chorus Pro.
- Numéro d'engagement juridique (chorusLegalCommitmentNumber): Le numéro EJ pour Chorus.

**ACTIVITÉS :**
- Activités (activityIds): Liste les IDs des prestations identifiées parmi la liste suivante : {{{json activities}}}.
    - Cherche des mots-clés comme "Fourniture de gaz", "Exploitation CVC", "Maintenance multi-technique", etc.
- Détails des activités (activitiesDetails): Pour chaque prestation identifiée dans 'activityIds', extrais les détails suivants. Retourne un tableau d'objets.
    - activityId: L'ID de l'activité.
    - amount: Le montant annuel HT.
    - termId: Le terme de facturation (ex: échu, à échoir). Retourne l'ID correspondant dans la liste : {{{json terms}}}.
    - scheduleId: La périodicité de facturation (ex: trimestriel, mensuel). Retourne l'ID correspondant dans la liste : {{{json schedules}}}.
    - revisionFormula: La formule de révision de prix.
    - revisionBaseIndices: Les valeurs de base des indices de révision (mois 0). Retourne un tableau d'objets { code: string, value: number, description?: string }. Cherche les valeurs comme "ATRD0", "TICGN0", "Indice_0", "Valeur initiale", etc.
    - SI l'activité est de type P1 (Fourniture d'énergie), extrais aussi :
        - weatherStation: La station météo de référence.
        - contractualTemperature: La température contractuelle moyenne.
        - contractualDJU: Les DJU contractuels.
        - contractualNB: Le NB contractuel.
        - ecsSmallQ: Le petit q ECS.
        - ecsNB: Le NB ECS.

**SITES :**
- Identifie TOUS les sites couverts par le marché (adresses, bâtiments distincts...).
- Pour chaque site, extrais :
  - name: Nom du site.
  - address, postalCode, city: Adresse complète.
  - billingSchedule: Périodicité de facturation (ex: "Mensuel", "Trimestriel").
  - term: Terme de paiement (ex: "Échu", "Échoir").
- Si un seul site est mentionné, retourne un tableau d'un élément.
`;
