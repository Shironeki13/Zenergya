# Sécurité : authentification, droits et mise en service

## Principe

1. L'utilisateur se connecte avec Firebase Auth (email/mot de passe ou Google).
2. Le navigateur envoie son ID token à `POST /api/auth/session`. Le serveur (Admin SDK) :
   - vérifie que l'email a une fiche dans **Utilisateurs** (collection `users`) ou figure dans `ADMIN_EMAILS` ; sinon accès refusé ;
   - rattache la fiche au compte Firebase à la première connexion (`authUid`) : un autre compte ne peut plus la reprendre ;
   - pose les custom claims `zen` (utilisateur autorisé) et `admin` (rôle coché « Administrateur ») ;
   - dépose un cookie de session httpOnly `__session` (5 jours).
3. Les règles Firestore et Storage n'autorisent que les jetons portant `zen == true`.
4. Le middleware redirige vers `/login` toute page demandée sans cookie de session.
5. Les routes API et les server actions (génération de factures, avoirs, IA, PDF) vérifient le cookie et relisent les droits à chaque appel.
6. Le code serveur accède à Firestore via l'Admin SDK (`src/services/firestore-admin.ts`), indépendamment des règles.

| Action | Utilisateur | Administrateur |
| --- | --- | --- |
| Lire / créer / modifier les données métier | ✅ | ✅ |
| Supprimer factures, avoirs, compteurs de numérotation | ❌ | ✅ |
| Gérer utilisateurs et rôles | ❌ | ✅ |
| Lancer la synchronisation des indices | ❌ | ✅ (ou appel planifié avec `CRON_SECRET`) |
| « Preview As » (aperçu de l'interface d'un autre utilisateur) | ❌ | ✅ (affichage seulement, les droits restent ceux de l'admin) |

## Mise en service (dans cet ordre)

> ⚠️ Déployer les règles **en dernier** : tant que les utilisateurs n'ont pas leurs droits (claims), des règles fermées les bloqueraient.

1. **Console Firebase → Authentication → Settings → User actions** : décocher « Enable create (sign-up) ».
   Les comptes sont créés par un administrateur (ou via Google), plus personne ne peut s'inscrire seul.
2. **Variables d'environnement** du backend (App Hosting ou Cloud Run) :
   - `ADMIN_EMAILS` : au moins votre email, pour garder la main ;
   - `CRON_SECRET` : chaîne aléatoire longue, à stocker dans Secret Manager.
   Voir `.env.example` et l'exemple dans `apphosting.yaml`.
3. **IAM** : le compte de service du backend doit avoir les rôles
   « Firebase Authentication Admin » (`roles/firebaseauth.admin`) et « Cloud Datastore User » (`roles/datastore.user`).
4. **Utilisateurs** : vérifier que chaque collaborateur a une fiche dans *Utilisateurs* avec **l'email exact** de son compte de connexion,
   et cocher « Administrateur » sur le ou les rôles concernés (*Utilisateurs → Rôles*).
5. **Déployer l'application**, puis se connecter avec chaque compte (ou attendre que chacun se reconnecte) : les claims sont posés à la connexion.
6. **Déployer les règles** :
   ```bash
   firebase deploy --only firestore:rules,storage
   ```
7. **Planifier la synchronisation des indices** (optionnel) avec Cloud Scheduler :
   `POST https://<domaine>/api/indices/sync` avec l'en-tête `Authorization: Bearer <CRON_SECRET>`.

## Développement local

- Renseigner `.env.local` à partir de `.env.example`, dont un identifiant Admin SDK
  (`GOOGLE_APPLICATION_CREDENTIALS` ou `FIREBASE_SERVICE_ACCOUNT_KEY`) et `ADMIN_EMAILS`.
- Il n'y a plus d'utilisateur fictif : il faut se connecter avec un vrai compte autorisé.
- Tests des règles Firestore (émulateur, Java requis) : `npm run test:rules`.

## Limites connues (prochaines étapes)

- Le périmètre (sociétés / agences / secteurs) et les modules d'un utilisateur filtrent l'interface, mais ne sont pas encore appliqués par les règles Firestore.
- Un utilisateur autorisé peut encore créer une facture directement depuis le navigateur : la numérotation et la création des factures doivent passer entièrement côté serveur (chantier 2).
