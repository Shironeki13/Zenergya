# Répertoire des entreprises (API de l'État)

Zenergya interroge l'**API Recherche d'entreprises** de l'État (`recherche-entreprises.api.gouv.fr`, données
Sirene et RNE, publique et sans clé) pour remplir et vérifier les fiches clients.

## Fonctions

- **Fiche client (création / modification) → « Rechercher dans le répertoire »** : recherche par nom, SIREN ou SIRET,
  filtrable par code postal ou département, entreprises cessées incluses ou non. « Utiliser » remplit raison sociale,
  adresse, code postal, ville et SIRET. Une entité publique (catégorie juridique 7xxx, administration ou collectivité)
  passe la fiche en client **public** et active le **dépôt Chorus**.
- **Fiche client → « Vérifier le SIRET »** : contrôle le SIRET enregistré et garde le résultat sur la fiche
  (`sireneCheck`) : établissement actif ou fermé, entreprise cessée, entité publique ou privée.
- **Facturation électronique** : si le dernier contrôle porte sur le SIRET actuel de la fiche, ses anomalies
  (établissement fermé, entreprise cessée, incohérence public / privé) apparaissent en avertissement sur les factures
  et dans « Clients à compléter ». Ce ne sont pas des blocages : la donnée date du dernier contrôle.

## Fonctionnement

- Appel **côté serveur** (`/api/entreprises/search`, session requise) : le navigateur n'appelle pas l'API directement.
- Seules les données utiles sont gardées : ni dirigeants, ni élus, ni données financières.
- **Limite de débit** de l'API (de l'ordre de quelques appels par seconde, partagée par adresse IP) : en cas de refus
  (429), un nouvel essai après un court délai, puis un message « réessayez dans quelques secondes ».
- Cache en mémoire de 10 minutes par recherche (par instance du serveur).
- États : entreprise `A` active / `C` cessée ; établissement `A` actif / `F` fermé.
- `RECHERCHE_ENTREPRISES_URL` permet de changer l'adresse de l'API (tests, miroir).

## À venir

- Contrôle en masse de la base clients (à l'import), en respectant la limite de débit.
