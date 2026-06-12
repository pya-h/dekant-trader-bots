# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache ca-certificates tzdata curl wget

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts

RUN npm run build && npm prune --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache ca-certificates tzdata curl wget tini \
  && chown -R node:node /app

# --chown so the `node` user can rewrite dist/.../dekant_pm.json at startup
# (program-sync runs as `node`); the embedded HEALTHCHECK only reads.
COPY --chown=node:node --from=builder /app/package.json /app/package-lock.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/scripts ./scripts
# The admin panel HTML the app serves at `/` (read at runtime from <root>/public).
COPY --chown=node:node public ./public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" || exit 1

# Sync the bundled IDL address to DEKANT_PROGRAM_ID (runtime env) before booting,
# so one image serves both the staging and main devnet programs. exec hands PID
# to node under tini for correct signal handling.
ENTRYPOINT ["/sbin/tini", "--", "sh", "-c", "node scripts/program-sync.mjs && exec node dist/server.js"]

