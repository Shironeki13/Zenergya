#!/usr/bin/env bash
# Démo Zenergya avec données SIMULÉES, dans Cloud Shell (ou en local) : émulateurs Firebase, jeu de données, application
# (build de production) et relais sur le port 3100, à ouvrir avec « Aperçu sur le Web » › « Modifier le port » › 3100.
# Rien n'est écrit dans un projet Firebase réel : tout reste dans les émulateurs, effacés à l'arrêt.
#   bash scripts/demo/demarrer.sh            (Ctrl+C pour tout arrêter)
#   bash scripts/demo/demarrer.sh --sans-build   (réutilise le build existant)
set -euo pipefail
cd "$(dirname "$0")/../.."

# Node 22 : firebase-admin ne fonctionne pas avec Node 25+ (Cloud Shell est passé à Node 26).
if [[ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 25 || "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 20 ]]; then
    NVM_SH=${NVM_DIR:-/usr/local/nvm}/nvm.sh; [[ -f "$NVM_SH" ]] || NVM_SH=$HOME/.nvm/nvm.sh
    [[ -f "$NVM_SH" ]] || { echo "Node 20 à 24 requis (actuel : $(node -v 2>/dev/null || echo absent)) et nvm introuvable."; exit 1; }
    echo "Passage à Node 22 (nvm)…"
    # shellcheck disable=SC1090
    set +u; source "$NVM_SH"; nvm install 22 > /dev/null; nvm use 22 > /dev/null; set -u
fi
[[ -d node_modules ]] || { echo "Installation des dépendances (environ 1,3 Go)…"; npm ci --no-audit --no-fund; }

PROJET=demo-zenergya
export FIREBASE_PROJECT_ID=$PROJET GCLOUD_PROJECT=$PROJET
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199
# Configuration web Firebase : servie à l'exécution par /api/firebase-config, JAMAIS intégrée au build (sinon le
# navigateur peut démarrer avec la configuration intégrée, sans le mode émulateur, et appeler les vrais serveurs Google).
CONFIG_WEB=(NEXT_PUBLIC_FIREBASE_API_KEY=demo-key NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$PROJET.firebaseapp.com NEXT_PUBLIC_FIREBASE_PROJECT_ID=$PROJET
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$PROJET.appspot.com NEXT_PUBLIC_FIREBASE_APP_ID=1:1:web:demo NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1)
for v in $(compgen -e | grep '^NEXT_PUBLIC_FIREBASE_' || true); do unset "$v"; done
# Navigateur : émulateurs joints par l'adresse de l'application (relais) ; actions serveur acceptées depuis l'aperçu.
export FIREBASE_WEB_EMULATOR_HOST=same-origin DEMO_ALLOWED_ORIGINS='*.cloudshell.dev,localhost:3100'
LOGS=${DEMO_LOGS:-/tmp/zenergya-demo}
mkdir -p "$LOGS"

PIDS=()
arreter() { echo; echo "Arrêt de la démo…"; for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done; wait 2>/dev/null || true; }
trap arreter EXIT INT TERM

for port in 3100 3101 8080 9099 9199; do
    if (exec 3<>/dev/tcp/127.0.0.1/$port) 2>/dev/null; then echo "Port $port déjà utilisé : arrêtez l'autre programme d'abord."; exit 1; fi
done

echo "1/4 Émulateurs Firebase (journal : $LOGS/emulateurs.log)"
npx --yes firebase-tools@14 emulators:start --only auth,firestore,storage --project $PROJET > "$LOGS/emulateurs.log" 2>&1 &
PIDS+=($!)
until grep -q "All emulators ready" "$LOGS/emulateurs.log" 2>/dev/null; do
    if ! kill -0 "${PIDS[0]}" 2>/dev/null; then echo "Les émulateurs n'ont pas démarré (Java 11+ requis) :"; tail -20 "$LOGS/emulateurs.log"; exit 1; fi
    sleep 2
done

echo "2/4 Jeu de données simulées"
npx tsx --require ./tests/setup-server.cjs scripts/demo/donnees.ts

if [[ "${1:-}" != "--sans-build" || ! -f .next/DEMO ]]; then
    echo "3/4 Build de production (quelques minutes ; journal : $LOGS/build.log)"
    npx next build > "$LOGS/build.log" 2>&1 || { tail -30 "$LOGS/build.log"; exit 1; }
    touch .next/DEMO   # build de démo (sans configuration intégrée)
else
    echo "3/4 Build existant réutilisé"
fi

echo "4/4 Application et relais"
env "${CONFIG_WEB[@]}" npx next start -p 3101 > "$LOGS/application.log" 2>&1 &
PIDS+=($!)
node scripts/demo/relais.mjs > "$LOGS/relais.log" 2>&1 &
PIDS+=($!)
until curl -s -o /dev/null -m 5 http://127.0.0.1:3100/login; do sleep 2; done

cat <<EOF

Démo prête. Cloud Shell : « Aperçu sur le Web » › « Modifier le port » › 3100 (en local : http://localhost:3100).
Comptes (mot de passe Demo-Zenergya-2026) :
  adv@example.com            ADV (Claire Martin)
  adv2@example.com           ADV (Julien Petit)
  contratheque@example.com   Contrathèque : validation des documents
  admin@example.com          Administrateur (sans le droit contrathèque)
  technicien@example.com     Commandes d'achat (demandeur)
  responsable@example.com    Validation N+1      directeur@example.com   Validation N+2
  achats@example.com         Validation achats, factures fournisseurs
Remise à zéro des données sans redémarrer : npm run demo:donnees (dans un autre terminal).
Extraction Excel des tables : npm run demo:extraction
Ctrl+C pour arrêter (les données simulées sont effacées).
EOF
wait
