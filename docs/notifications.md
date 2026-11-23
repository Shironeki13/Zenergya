# Notifications par mail

Zenergya prévient par mail les personnes concernées par la vie d'un contrat. Les mails sont **internes** : seules les
adresses des domaines autorisés en reçoivent.

## Événements

| Événement | Destinataires par défaut |
|---|---|
| Document déposé (contrat, avenant, ordre de service, reconduction, résiliation, changement de syndic ou de bureau d'études) | la contrathèque |
| Document validé | le déposant, le responsable de facturation du contrat |
| Document refusé (avec le motif) | le déposant |
| Document en attente depuis trop longtemps | la contrathèque |
| Date limite de préavis qui approche | le responsable de facturation, son N+1 |
| Échéance qui approche, échéance dépassée | le responsable de facturation, la contrathèque |
| Résiliation validée | le responsable de facturation, son N+1 |

Chaque événement a une **règle** : active ou non, des destinataires **par rôle** (déposant, contrathèque, responsable
de facturation du contrat, son N+1, administrateurs) et des **adresses fixes**. Les rôles se résolvent sur le contrat :
la contrathèque est l'ensemble des utilisateurs dont le rôle a le droit « Contrathèque » ; le responsable de
facturation est celui du contrat ; son N+1 est son responsable sur sa fiche utilisateur.

## Modèles de mail à balises

L'objet et le corps de chaque mail sont des **modèles** que l'administrateur modifie (Administration › Notifications,
onglet « Modèle du mail »). Un modèle est du texte où des **balises** entre chevrons doubles sont remplacées par les
valeurs du contrat et du document :

```
Objet : Résiliation à valider en priorité — <<Client>>

Bonjour,

Une résiliation est demandée pour le contrat <<Numéro du contrat>>.
Effet demandé : <<Date d'effet>>
Motif : <<Objet du document>>

<<Lien vers le contrat>>
```

- Les balises se choisissent dans une liste et s'insèrent d'un clic à l'endroit du curseur ; l'aperçu se met à jour
  pendant la saisie, sur un exemple.
- **Par type de document** : pour les événements qui portent sur un document (déposé, validé, refusé, en attente), un
  modèle peut être propre à un type (contrat, avenant, ordre de service, reconduction, résiliation, changement de
  syndic, changement de bureau d'études). Le modèle en vigueur est celui du type s'il existe, sinon celui de
  l'événement (« Tous les documents »), sinon le modèle d'origine. On revient au modèle hérité d'un clic.
- Une balise **inconnue** ou mal fermée est refusée à l'enregistrement.
- Une **ligne dont toutes les balises sont vides disparaît** du mail (« Motif : <<Motif du refus>> » sans motif).
- Le corps est du texte : pas de mise en forme HTML. Dans le mail, chaque ligne devient un paragraphe et les adresses
  web des liens cliquables ; le modèle et les valeurs sont échappés.

| Groupe | Balises |
|---|---|
| Contrat | Numéro du contrat, Client, Lien vers le contrat |
| Document | Type de document, Un document, Le document, e (accord), Objet du document, Déposé par, Date de dépôt, Décidé par, Motif du refus, Date d'effet |
| Montants | Montant P1 / P2 / P3 / P3R du contrat, Montant total du contrat, Montants du contrat (une ligne par prestation), Impact P1 / P2 / P3 / P3R, Impact total, Impacts par prestation (une ligne par prestation touchée) |
| Dates et délais | Nombre de jours, Date limite, Échéance du contrat, Durée du préavis, Reconduction, Date du jour |

Les montants sont en € HT par an. Une prestation sans montant, ou un document sans impact, donne une balise vide :
sa ligne disparaît. Les impacts sont signés (« +1 200,00 € », « −300,00 € »).

L'onglet « Destinataires » règle, par événement, l'activation, les rôles et les adresses fixes (domaines internes
seulement). Toute modification est contrôlée par le serveur et tracée (auteur, date).

## Garde-fous

- **Interne seulement** : une adresse dont le domaine n'est pas dans la liste des domaines internes est écartée, et le
  journal le dit. Sans domaine paramétré, rien ne part.
- **Une seule fois** : un même événement sur un même document (ou un même palier de rappel) n'est notifié qu'une fois,
  même si l'opération est rejouée.
- **Jamais bloquant** : une notification qui échoue ne fait pas échouer le dépôt ou la validation qui la déclenche.
- **Rien de silencieux** : un événement sans destinataire (contrat sans responsable de facturation, par exemple) est
  journalisé « sans destinataire ».
- Le texte saisi par les utilisateurs (objet d'un avenant, motif de refus) est échappé dans le mail.

## Modes d'envoi

| Mode | Effet |
|---|---|
| `simulation` (défaut) | le mail est composé et journalisé « simulé » ; rien ne part |
| `messagerie` | le mail est journalisé « à envoyer », pour le transport de messagerie |
| `arret` | aucune notification n'est composée |

## Réglages

Document `notificationsReglages/reglages` (écrit par le serveur seulement), à défaut variables d'environnement :

| Réglage | Variable | Rôle |
|---|---|---|
| `mode` | — | simulation, messagerie ou arrêt |
| `expediteur` | `NOTIFICATIONS_EXPEDITEUR` | boîte d'envoi |
| `domaines` | `NOTIFICATIONS_DOMAINES` (séparés par des virgules) | domaines internes autorisés |
| `urlApplication` | `NOTIFICATIONS_URL_APPLICATION` | adresse de l'application, pour le lien « vie du contrat » des mails |
| `regles` | — | règles propres, par événement (à défaut : le tableau ci-dessus) |

## Écran

Administration › Notifications (administrateur) : mode en vigueur et ce qui manque aux réglages, liste des événements
avec leurs destinataires et l'aperçu du mail sur un exemple, journal des cent dernières notifications (destinataires
retenus et écartés, statut, mail complet).

## Code

- `src/lib/notifications/balises.ts` : balises, contrôle et rendu d'un modèle (pur, testé).
- `src/lib/notifications/modeles.ts` : événements, règles, calcul des destinataires, modèles d'origine (pur, testé).
- `src/services/notifications-admin.ts` : réglages, annuaire d'un contrat, `notifier`, journal (collection
  `notifications`).
- Tests : `tests/notifications.test.ts`, `tests/notifications-flow.test.ts`.

## À venir

Déclenchement par les dépôts et validations, rappels quotidiens (préavis, échéances, documents en attente), envoi
réel par la messagerie Google, trace des mails sur la frise du contrat.
