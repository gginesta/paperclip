#!/bin/sh
set -e

# Capture runtime UID/GID from environment variables, defaulting to 1000
PUID=${USER_UID:-1000}
PGID=${USER_GID:-1000}

# Adjust the node user's UID/GID if they differ from the runtime request
# and fix volume ownership only when a remap is needed
changed=0

if [ "$(id -u node)" -ne "$PUID" ]; then
    echo "Updating node UID to $PUID"
    usermod -o -u "$PUID" node
    changed=1
fi

if [ "$(id -g node)" -ne "$PGID" ]; then
    echo "Updating node GID to $PGID"
    groupmod -o -g "$PGID" node
    usermod -g "$PGID" node
    changed=1
fi

# Railway persistent volumes can retain root-owned state from earlier deploys or
# builder/runtime UID changes. Paperclip must create logs/db/secrets under this
# tree before the Node process starts, so repair ownership on every boot when
# needed, not only when USER_UID/USER_GID changes.
mkdir -p /paperclip/instances/default
if [ "$changed" = "1" ] || [ ! -w /paperclip ] || [ ! -w /paperclip/instances/default ]; then
    chown -R node:node /paperclip
fi

# Railway exposes public domains through RAILWAY_PUBLIC_DOMAIN/RAILWAY_STATIC_URL.
# Paperclip authenticated+public mode needs an explicit auth/public base URL;
# derive it from Railway metadata so a branch redeploy does not crash when the
# service relies on Railway's generated domain instead of hand-set auth vars.
if [ -n "${RAILWAY_PUBLIC_DOMAIN:-${RAILWAY_STATIC_URL:-}}" ]; then
    railway_domain="${RAILWAY_PUBLIC_DOMAIN:-${RAILWAY_STATIC_URL}}"
    case "$railway_domain" in
        http://*|https://*) railway_public_url="$railway_domain" ;;
        *) railway_public_url="https://$railway_domain" ;;
    esac

    if [ -z "${PAPERCLIP_PUBLIC_URL:-}" ]; then
        export PAPERCLIP_PUBLIC_URL="$railway_public_url"
    fi

    if [ -z "${BETTER_AUTH_BASE_URL:-}" ] && [ -z "${BETTER_AUTH_URL:-}" ] && [ -z "${PAPERCLIP_AUTH_PUBLIC_BASE_URL:-}" ]; then
        export BETTER_AUTH_BASE_URL="$PAPERCLIP_PUBLIC_URL"
    fi

    if [ "${PAPERCLIP_DEPLOYMENT_MODE:-}" = "authenticated" ] && [ "${PAPERCLIP_DEPLOYMENT_EXPOSURE:-private}" = "private" ] && [ "${PAPERCLIP_FORCE_PRIVATE:-false}" != "true" ]; then
        export PAPERCLIP_DEPLOYMENT_EXPOSURE="public"
    fi
fi

exec gosu node "$@"
