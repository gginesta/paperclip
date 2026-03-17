FROM node:lts-trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g paperclipai@0.3.1

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3100 \
  SERVE_UI=true \
  PAPERCLIP_HOME=/paperclip \
  PAPERCLIP_INSTANCE_ID=default

EXPOSE 3100

WORKDIR /usr/local/lib/node_modules/paperclipai
CMD ["node", "-e", "import('./node_modules/@paperclipai/server/dist/index.js').then(m => m.startServer())"]
