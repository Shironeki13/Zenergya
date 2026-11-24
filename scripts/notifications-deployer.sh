#!/usr/bin/env bash
# Déploie la fonction planifiée « notifications-rappels » (rappels quotidiens de la contrathèque) et son déclencheur.
# Voir docs/notifications.md. À lancer à la main, après accord : ce script crée des ressources dans le projet GCP.
#
#   PROJET=mon-projet ./scripts/notifications-deployer.sh            # déploie (demande confirmation)
#   PROJET=mon-projet ./scripts/notifications-deployer.sh --essai    # affiche les commandes sans rien exécuter
#
# Variables : PROJET (obligatoire), REGION (europe-west1), HORAIRE (« 30 6 * * * » : tous les jours à 6 h 30, heure de Paris).
# La fonction n'envoie rien par elle-même : elle compose les rappels, qui suivent le mode réglé dans l'application
# (Administration › Notifications : simulation, messagerie ou arrêt).
set -euo pipefail

PROJET="${PROJET:?Indiquez le projet GCP : PROJET=mon-projet $0}"
REGION="${REGION:-europe-west1}"
HORAIRE="${HORAIRE:-30 6 * * *}"
FONCTION="notifications-rappels"
COMPTE_FONCTION="notifications-rappels@${PROJET}.iam.gserviceaccount.com"     # exécute la fonction, lit les contrats, écrit le journal
COMPTE_PLANIF="notifications-planificateur@${PROJET}.iam.gserviceaccount.com"  # seul autorisé à appeler la fonction
ESSAI=false; [ "${1:-}" = "--essai" ] && ESSAI=true

lancer() { echo "+ $*"; $ESSAI || "$@"; }
existe() { "$@" >/dev/null 2>&1; }

cd "$(dirname "$0")/.."
echo "Projet : $PROJET — région : $REGION — horaire : « $HORAIRE » (Europe/Paris)"
if ! $ESSAI; then read -r -p "Déployer la fonction $FONCTION dans le projet $PROJET ? (oui/non) " rep; [ "$rep" = "oui" ] || { echo "Abandon."; exit 1; }; fi

echo "1/5 Construction du paquet"
lancer npm run functions:build

echo "2/5 Comptes de service"
existe gcloud iam service-accounts describe "$COMPTE_FONCTION" --project "$PROJET" || lancer gcloud iam service-accounts create notifications-rappels --project "$PROJET" --display-name "Rappels de la contrathèque"
existe gcloud iam service-accounts describe "$COMPTE_PLANIF" --project "$PROJET" || lancer gcloud iam service-accounts create notifications-planificateur --project "$PROJET" --display-name "Planificateur des rappels"
# La fonction lit les contrats et écrit le journal des notifications dans Firestore : rien d'autre.
lancer gcloud projects add-iam-policy-binding "$PROJET" --member "serviceAccount:${COMPTE_FONCTION}" --role roles/datastore.user --condition=None --quiet

echo "3/5 Fonction (non publique)"
lancer gcloud functions deploy "$FONCTION" --gen2 --project "$PROJET" --region "$REGION" --runtime nodejs22 \
    --source functions/notifications-rappels --entry-point rappelsNotifications --trigger-http --no-allow-unauthenticated \
    --service-account "$COMPTE_FONCTION" --timeout 300s --memory 512Mi --max-instances 1 \
    --set-env-vars "FIREBASE_PROJECT_ID=${PROJET}"

URL="https://${REGION}-${PROJET}.cloudfunctions.net/${FONCTION}"
$ESSAI || URL="$(gcloud functions describe "$FONCTION" --gen2 --project "$PROJET" --region "$REGION" --format 'value(serviceConfig.uri)')"
# Seul le planificateur peut appeler la fonction.
lancer gcloud functions add-invoker-policy-binding "$FONCTION" --project "$PROJET" --region "$REGION" --member "serviceAccount:${COMPTE_PLANIF}"

echo "4/5 Déclencheur planifié"
if existe gcloud scheduler jobs describe "$FONCTION" --project "$PROJET" --location "$REGION"; then ACTION=update; else ACTION=create; fi
lancer gcloud scheduler jobs "$ACTION" http "$FONCTION" --project "$PROJET" --location "$REGION" \
    --schedule "$HORAIRE" --time-zone "Europe/Paris" --uri "$URL" --http-method POST \
    --oidc-service-account-email "$COMPTE_PLANIF" --oidc-token-audience "$URL" \
    --attempt-deadline 320s --max-retry-attempts 2

echo "5/5 Indicateur pour les alertes (rappel non composé, rappel sans destinataire, passage impossible)"
FILTRE='resource.type="cloud_run_revision" AND resource.labels.service_name="notifications-rappels" AND jsonPayload.composant="notifications-rappels" AND severity>=WARNING AND jsonPayload.probleme:*'
existe gcloud logging metrics describe notifications_rappels_problemes --project "$PROJET" || lancer gcloud logging metrics create notifications_rappels_problemes --project "$PROJET" \
    --description "Rappels de la contrathèque : rappel non composé, sans destinataire, ou passage impossible" --log-filter "$FILTRE"

cat <<FIN

Terminé. Fonction : $URL
- Passage à la demande :  gcloud scheduler jobs run $FONCTION --project $PROJET --location $REGION
  (ou, dans l'application : Administration › Notifications › « Lancer les rappels maintenant »)
- Le compte rendu de chaque passage et les mails composés sont visibles dans l'application (Administration › Notifications).
FIN
