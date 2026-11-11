#!/usr/bin/env bash
# Déploie la fonction planifiée « indices-sync » (mise à jour automatique des indices) et son déclencheur.
# Voir docs/indices-automatiques.md. À lancer à la main, après accord : ce script crée des ressources dans le projet GCP.
#
#   PROJET=mon-projet ./scripts/indices-deployer.sh            # déploie (demande confirmation)
#   PROJET=mon-projet ./scripts/indices-deployer.sh --essai    # affiche les commandes sans rien exécuter
#
# Variables : PROJET (obligatoire), REGION (europe-west1), HORAIRE (« 0 6 * * * » : tous les jours à 6 h, heure de Paris).
set -euo pipefail

PROJET="${PROJET:?Indiquez le projet GCP : PROJET=mon-projet $0}"
REGION="${REGION:-europe-west1}"
HORAIRE="${HORAIRE:-0 6 * * *}"
FONCTION="indices-sync"
COMPTE_FONCTION="indices-sync@${PROJET}.iam.gserviceaccount.com"        # exécute la fonction, écrit les indices
COMPTE_PLANIF="indices-planificateur@${PROJET}.iam.gserviceaccount.com"  # seul autorisé à appeler la fonction
ESSAI=false; [ "${1:-}" = "--essai" ] && ESSAI=true

lancer() { echo "+ $*"; $ESSAI || "$@"; }
existe() { "$@" >/dev/null 2>&1; }

cd "$(dirname "$0")/.."
echo "Projet : $PROJET — région : $REGION — horaire : « $HORAIRE » (Europe/Paris)"
if ! $ESSAI; then read -r -p "Déployer la fonction $FONCTION dans le projet $PROJET ? (oui/non) " rep; [ "$rep" = "oui" ] || { echo "Abandon."; exit 1; }; fi

echo "1/5 Construction du paquet"
lancer npm run functions:build

echo "2/5 Comptes de service"
existe gcloud iam service-accounts describe "$COMPTE_FONCTION" --project "$PROJET" || lancer gcloud iam service-accounts create indices-sync --project "$PROJET" --display-name "Mise à jour des indices"
existe gcloud iam service-accounts describe "$COMPTE_PLANIF" --project "$PROJET" || lancer gcloud iam service-accounts create indices-planificateur --project "$PROJET" --display-name "Planificateur des indices"
# La fonction lit et écrit les indices dans Firestore : rien d'autre.
lancer gcloud projects add-iam-policy-binding "$PROJET" --member "serviceAccount:${COMPTE_FONCTION}" --role roles/datastore.user --condition=None --quiet

echo "3/5 Fonction (non publique)"
lancer gcloud functions deploy "$FONCTION" --gen2 --project "$PROJET" --region "$REGION" --runtime nodejs22 \
    --source functions/indices-sync --entry-point syncIndices --trigger-http --no-allow-unauthenticated \
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

echo "5/5 Indicateur pour les alertes (sources en échec, valeurs rejetées, indices en retard)"
FILTRE='resource.type="cloud_run_revision" AND resource.labels.service_name="indices-sync" AND jsonPayload.composant="indices-sync" AND severity>=WARNING AND jsonPayload.probleme:*'
existe gcloud logging metrics describe indices_sync_problemes --project "$PROJET" || lancer gcloud logging metrics create indices_sync_problemes --project "$PROJET" \
    --description "Indices : source en échec, valeur rejetée ou indice en retard" --log-filter "$FILTRE"

cat <<FIN

Terminé. Fonction : $URL
- Essai sans écriture :  gcloud scheduler jobs run $FONCTION --project $PROJET --location $REGION   (passage réel)
                         ou, avec votre compte : curl -H "Authorization: Bearer \$(gcloud auth print-identity-token)" "$URL?dryRun=1"
- Alerte : dans Cloud Monitoring, créez une règle d'alerte sur l'indicateur « indices_sync_problemes » (> 0) avec votre canal
  de notification (e-mail). Le journal de chaque passage est aussi visible dans l'application (Facturation › Indices).
FIN
