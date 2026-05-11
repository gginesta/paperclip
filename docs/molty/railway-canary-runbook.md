# Railway Canary Runbook — Paperclip v2026.428.0

This branch starts from upstream stable `v2026.428.0` and only applies Railway-safe packaging notes.

## Why this exists
The current `gginesta/paperclip` production deploy uses the old `paperclipai@0.3.1` global npm wrapper. Upstream now builds and runs the server from source, includes current adapter tooling, and has migrations/recovery fixes that the old deploy does not have.

## Do not hot-update production
Do **not** point `paperclip-production-83f5` at this branch directly. Create a canary service first and run it against a copied/restored database or disposable database.

## Required Railway service setup

- Source repo: `gginesta/paperclip`
- Branch: `molty/paperclip-upstream-canary-20260511`
- Persistent volume mount: `/paperclip`
- Port: `3100`

Required variables:

```text
NODE_ENV=production
PORT=3100
HOST=0.0.0.0
PAPERCLIP_HOME=/paperclip
PAPERCLIP_INSTANCE_ID=default
PAPERCLIP_CONFIG=/paperclip/instances/default/config.json
PAPERCLIP_DEPLOYMENT_MODE=authenticated
PAPERCLIP_DEPLOYMENT_EXPOSURE=public
PAPERCLIP_PUBLIC_URL=https://<canary-domain>
PAPERCLIP_API_URL=https://<canary-domain>
BETTER_AUTH_SECRET=<new-or-copied-secret>
DATABASE_URL=<copied-or-disposable-postgres-url>
```

For a copied DB canary, keep `BETTER_AUTH_SECRET` compatible with the copied auth sessions if you want existing login sessions to survive. For a clean DB canary, use a fresh secret and complete the board-claim/login flow.

Migrations:

```text
PAPERCLIP_MIGRATION_AUTO_APPLY=true
```

Use this only on a copied/disposable DB first. Do not run first migration against the only production DB.

## Smoke tests

1. `/api/health` returns ok.
2. Board login works.
3. `/api/companies` shows expected companies.
4. Create/read/comment a disposable issue.
5. Verify Molty/Raphael/Leonardo/April OpenClaw gateway adapter credentials.
6. Run one no-op heartbeat for each agent.
7. Verify pause/resume agent UI.
8. Verify stranded-assignment recovery does not spawn loops.

## Cutover criteria

Cut over only after:

- canary health is green
- board/team-lead access model is explicit
- heartbeat smoke tests pass
- DB backup and rollback path are verified
- old service remains untouched until cutover approval
