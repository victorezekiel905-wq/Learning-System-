# syntax=docker/dockerfile:1.7
# SwiftCipher production image (Next.js standalone output, non-root).
# Build args are the public values baked into the client bundle.
# Debian, not Alpine: Alpine's LibreOffice build aborts on many PowerPoint files
# ("terminate called after throwing ... uno::RuntimeException", code 134). All
# stages share the base so native modules (@napi-rs/canvas) match the C library.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SSO_PROVIDERS=""
ARG NEXT_PUBLIC_LEGAL_ENTITY
ARG NEXT_PUBLIC_LEGAL_ADDRESS
ARG NEXT_PUBLIC_SUPPORT_EMAIL
ARG NEXT_PUBLIC_PRIVACY_EMAIL
ARG NEXT_PUBLIC_HOSTING_REGION
ARG NEXT_PUBLIC_GOVERNING_LAW=""
ARG NEXT_PUBLIC_RELEASE=""
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SSO_PROVIDERS=$NEXT_PUBLIC_SSO_PROVIDERS \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
# LibreOffice turns PowerPoint uploads into PDF, so imported decks keep their design.
# Liberation and Carlito/Caladea have the same letter widths as Arial, Times and
# Calibri/Cambria, so text wraps as it does in PowerPoint.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-impress fontconfig \
      fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
# svp: LibreOffice's headless drawing backend (no X server or desktop libraries needed).
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 SAL_USE_VCLPLUGIN=svp
RUN groupadd --system app && useradd --system --gid app --create-home app
COPY --from=builder /app/public ./public
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server.js"]
