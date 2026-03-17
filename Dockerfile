FROM node:lts-trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g paperclipai@0.3.1

COPY <<-"EOF" /tmp/paperclip-config.json
{"$meta": {"version": 1, "updatedAt": "2026-03-17T13:00:00.000Z", "source": "onboard"}, "database": {"mode": "postgres", "backup": {"enabled": false, "intervalMinutes": 60, "retentionDays": 30, "dir": "/paperclip/instances/default/data/backups"}}, "logging": {"mode": "file", "logDir": "/paperclip/instances/default/logs"}, "server": {"deploymentMode": "authenticated", "exposure": "public", "host": "0.0.0.0", "port": 3100, "allowedHostnames": [], "serveUi": true}, "auth": {"baseUrlMode": "explicit", "publicBaseUrl": "https://paperclip-production-83f5.up.railway.app", "disableSignUp": false}, "storage": {"provider": "local_disk", "localDisk": {"baseDir": "/paperclip/instances/default/data/storage"}, "s3": {"bucket": "paperclip", "region": "us-east-1", "prefix": "", "forcePathStyle": false}}, "secrets": {"provider": "local_encrypted", "strictMode": false, "localEncrypted": {"keyFilePath": "/paperclip/instances/default/secrets/master.key"}}}
EOF

COPY <<-"ENTRY" /entrypoint.sh
#!/bin/sh
set -e
mkdir -p /paperclip/instances/default/data/storage
mkdir -p /paperclip/instances/default/data/backups
mkdir -p /paperclip/instances/default/logs
mkdir -p /paperclip/instances/default/secrets
mkdir -p /paperclip/instances/default/db
if [ ! -f /paperclip/instances/default/config.json ]; then
  cp /tmp/paperclip-config.json /paperclip/instances/default/config.json
  echo "Config copied to volume"
fi
exec paperclipai run
ENTRY

RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production \
  HOME=/paperclip \
  HOST=0.0.0.0 \
  PORT=3100 \
  SERVE_UI=true \
  PAPERCLIP_HOME=/paperclip \
  PAPERCLIP_INSTANCE_ID=default \
  PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  BETTER_AUTH_URL=https://paperclip-production-83f5.up.railway.app

EXPOSE 3100

CMD ["/entrypoint.sh"]
