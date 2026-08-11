FROM node:lts-trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*

ARG PAPERCLIP_VERSION=2026.722.0
RUN npm install -g paperclipai@${PAPERCLIP_VERSION} \
  && node -p "require('/usr/local/lib/node_modules/paperclipai/package.json').version" | grep -Fx "${PAPERCLIP_VERSION}"

COPY --chmod=755 scripts/patch-paperclip-dependencies.mjs /usr/local/bin/patch-paperclip-dependencies.mjs
RUN node /usr/local/bin/patch-paperclip-dependencies.mjs \
      --root /usr/local/lib/node_modules/paperclipai \
  && npm install --prefix /usr/local/lib/node_modules/paperclipai --omit=dev --ignore-scripts --legacy-peer-deps \
  && node /usr/local/bin/patch-paperclip-dependencies.mjs \
      --root /usr/local/lib/node_modules/paperclipai --verify \
  && npm audit --prefix /usr/local/lib/node_modules/paperclipai --omit=dev --audit-level=high

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3100 \
  SERVE_UI=true \
  PAPERCLIP_HOME=/paperclip \
  PAPERCLIP_INSTANCE_ID=default

EXPOSE 3100

WORKDIR /usr/local/lib/node_modules/paperclipai
COPY entrypoint.mjs ./entrypoint.mjs
CMD ["node", "entrypoint.mjs"]
