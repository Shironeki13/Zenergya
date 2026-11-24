# Notifications par mail

Zenergya prévient par mail les personnes concernées par la vie d'un contrat. Les mails sont **internes** : seules les
adresses des domaines autorisés en reçoivent.

## Événements

| Événement | Destinataires par défaut |
|---|---|
| Document déposé (contrat, avenant, ordre de service, reconduction, résiliation, changement de syndic ou de bureau d'études) | la contrathèque |
| Document validé | le déposant, le responsable de facturation du contrat |
| Document refusé (avec le motif) | le déposant |
| Documents en attente (récapitulatif) | la contrathèque |
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
- **Par type de document** : pour les événements qui portent sur un document (déposé, validé, refusé), un
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
| Récapitulatif | Nombre de documents, Liste des documents (une ligne par document en attente), Lien vers la contrathèque |
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

## Déclenchement

| Moment | Événement |
|---|---|
| Dépôt d'un avenant, d'un ordre de service, d'une reconduction, d'une résiliation, d'un changement de syndic ou de bureau d'études | document déposé |
| Création d'un contrat par l'assistant ; contrat refusé puis corrigé | document déposé (type « contrat ») |
| Validation par la contrathèque | document validé ; pour une résiliation, en plus : résiliation validée |
| Refus par la contrathèque | document refusé, avec le motif |

Le mail reprend les valeurs du document et du contrat au moment de l'événement (objet, déposant, date d'effet,
impacts et montants par prestation). Un document refusé puis redéposé est notifié de nouveau. La retouche d'un contrat
encore en attente ne renvoie pas de mail. Code : `src/services/notifications-contrats.ts`.

## Rappels programmés

Une fois par jour, Zenergya relit les contrats actifs et les documents en attente, et compose les rappels dus :

| Rappel | Quand (réglable) | Événement |
|---|---|---|
| Date limite de préavis | 90, 60 et 30 jours avant | préavis qui approche |
| Échéance | 180, 90 et 30 jours avant | échéance qui approche |
| Échéance dépassée, contrat toujours actif | dès le dépassement, puis tous les 30 jours | échéance dépassée |
| Documents et contrats en attente de validation | quand l'un d'eux atteint 7, 14, 21… jours d'attente | documents en attente (récapitulatif) |

- **Un seul mail pour les documents en attente** : le récapitulatif liste tous les documents qui attendent depuis 7
  jours ou plus (contrat, client, type, dépôt, jours d'attente, objet), du plus ancien au plus récent, avec un lien
  vers la contrathèque. Il part au plus une fois par jour, et seulement le jour où un document franchit un nouveau
  seuil : pas de mail quand rien n'a bougé.
- **Une fois par palier** : le palier « 60 jours » d'une date limite donnée n'est rappelé qu'une fois, même si la tâche
  tourne plusieurs fois. Si l'échéance du contrat change (reconduction), ses paliers repartent.
- **Pas de rafale** : si la tâche est restée arrêtée, seul le palier courant est rappelé, pas ceux qu'elle a manqués.
- Le préavis se calcule à partir de la durée écrite sur le contrat (« 3 mois ») ; illisible ou absente, il n'y a pas
  de rappel de préavis (l'échéance, elle, est rappelée), et rien n'est inventé.
- Contrats résiliés, terminés, en brouillon ou non validés : aucun rappel.
- Chaque passage est tracé (collection `notificationsPassages`) : contrats et documents examinés, rappels dus, mails
  composés, rappels sans destinataire, erreurs. L'écran montre le dernier.

Les paliers se règlent dans Administration › Notifications › « Rappels programmés », où un bouton lance aussi les
rappels à la demande. Le texte et les destinataires de chaque rappel se règlent comme les autres événements.

**Tâche quotidienne** : fonction planifiée `notifications-rappels` (`functions/notifications-rappels`, construite par
`npm run functions:build`), appelée chaque jour par Cloud Scheduler. Elle n'envoie rien par elle-même : elle compose
les rappels, qui suivent le mode réglé dans l'application. Déploiement : `scripts/notifications-deployer.sh`
(`--essai` pour voir les commandes), à lancer à la main après accord — il crée la fonction, deux comptes de service
et le déclencheur dans le projet GCP.

Code : `src/lib/notifications/rappels.ts` (pur), `src/services/notifications-rappels.ts`.

## Trace sur la vie du contrat

Sur la fiche d'un contrat, onglet « Vie du contrat », chaque étape de la frise porte les mails qui la concernent : une
enveloppe et leur nombre sous le point, et dans le détail la liste — date, événement, destinataires, objet, et si le
mail est parti (simulé, à envoyer, envoyé, échec, sans destinataire). Un mail de dépôt, de validation ou de refus se
rattache à son document ; un rappel de préavis à la date limite de préavis ; un rappel d'échéance à l'échéance. Un
lien « Voir tous les mails de ce contrat » en donne la liste complète. Le corps des mails n'est pas affiché ici (il
est dans le journal de l'administrateur) ; le récapitulatif des documents en attente, qui porte sur tous les contrats,
n'y figure pas. La lecture respecte le périmètre de l'utilisateur.

Code : `src/lib/notifications/trace.ts`, lecture `notificationsDuContrat`.

## À venir

Envoi réel par la messagerie Google, mêmes notifications pour les commandes et les heures à valider.
