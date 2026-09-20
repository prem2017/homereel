# Build context is the repository root. Build via ./scripts/run-docker, which
# wires up the context and your .env settings for you.

# ---------- Stage 1: build the frontend ----------
FROM node:24-alpine AS web-builder

WORKDIR /app

# Manifests first: this layer stays cached until dependencies actually change,
# so editing source code does not trigger a reinstall.
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/

# ci (not install) installs exactly what package-lock.json pins, so the image
# is reproducible.
RUN npm ci

COPY web/ web/
RUN npm run build --workspace web

# ---------- Stage 2: runtime ----------
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/

# Only the server's production dependencies - none of the build toolchain.
RUN npm ci --omit=dev --workspace server --include-workspace-root=false \
  && npm cache clean --force

COPY server/ server/
COPY --from=web-builder /app/web/dist web/dist

ENV PORT=5000
ENV MEDIA_DIR=/media
ENV WEB_DIST=/app/web/dist

EXPOSE 5000

# ponytail: runs as root so it can always read the mounted media folder
# regardless of the host user's uid (ceiling: fine for a trusted home LAN).
# The mount is writable - downloaded subtitles land there, bounded by
# server/subtitles/store.js - and the container is unprivileged. Upgrade: add
# `user: "${UID}:${GID}"` in compose.yml if you expose this beyond your LAN.
CMD ["node", "server/index.js"]
