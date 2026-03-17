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

# Entrypoint: promote user to admin if needed, then start server
CMD ["node", "-e", "\
const { startServer } = await import('./node_modules/@paperclipai/server/dist/index.js');\
const srv = await startServer();\
// After server starts, promote user via DB\
try {\
  const pg = await import('./node_modules/postgres/src/index.js');\
  const sql = pg.default(process.env.DATABASE_URL);\
  const users = await sql\`SELECT id, email FROM \\\"user\\\" WHERE email = 'guillermo.ginesta@gmail.com'\`;\
  if (users.length > 0) {\
    const uid = users[0].id;\
    await sql\`DELETE FROM instance_user_roles WHERE user_id = 'local-board'\`;\
    await sql\`INSERT INTO instance_user_roles (user_id, role) VALUES (\${uid}, 'instance_admin') ON CONFLICT DO NOTHING\`;\
    console.log('Promoted ' + uid + ' to instance_admin');\
  }\
  await sql.end();\
} catch(e) { console.log('Admin promotion note:', e.message); }\
"]
