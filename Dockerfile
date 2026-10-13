# Image de production pour Cloud Run (Next.js en mode « standalone »).
# Image de base via mirror.gcr.io (miroir Google de Docker Hub) : évite les limites de téléchargement de Docker Hub.

FROM mirror.gcr.io/library/node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM mirror.gcr.io/library/node:20-bookworm-slim AS builder
WORKDIR /app

# Configuration web Firebase : intégrée au JavaScript du navigateur au moment du build,
# elle doit donc être fournie ici (voir cloudbuild.yaml), pas seulement à l'exécution.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
RUN if [ -z "$NEXT_PUBLIC_FIREBASE_API_KEY" ] || [ -z "$NEXT_PUBLIC_FIREBASE_PROJECT_ID" ]; then \
      echo "ERREUR : variables NEXT_PUBLIC_FIREBASE_* manquantes. Renseignez les substitutions _NEXT_PUBLIC_FIREBASE_* du déclencheur Cloud Build (voir docs/deploiement-cloud-run.md)." >&2; \
      exit 1; \
    fi

ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM mirror.gcr.io/library/node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 8080
CMD ["node", "server.js"]
