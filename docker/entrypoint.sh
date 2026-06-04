#!/bin/sh
# Installs the locally-built n8n-nodes-smbclient package (mounted at
# /opt/code-temp) into n8n's user nodes directory, then starts n8n.
#
# The host must run `npm run build` (or `pnpm build`) first so that
# /opt/code-temp/dist exists — n8n loads the compiled files, not the .ts.
set -e

SOURCE_DIR="/opt/code-temp"
NODES_DIR="/home/node/.n8n/nodes"
PKG_NAME="n8n-nodes-smbclient"

if [ ! -d "$SOURCE_DIR/dist" ]; then
	echo "WARNING: $SOURCE_DIR/dist not found."
	echo "         Run 'npm run build' on the host, then restart this container."
fi

mkdir -p "$NODES_DIR"
cd "$NODES_DIR"

[ -f package.json ] || echo '{"name":"installed-nodes","private":true}' >package.json

if [ ! -d "node_modules/$PKG_NAME" ] || [ "${REINSTALL_SMB_NODE:-false}" = "true" ]; then
	echo "Installing $PKG_NAME from $SOURCE_DIR ..."
	npm install "$SOURCE_DIR" --no-audit --no-fund --loglevel error
else
	echo "$PKG_NAME already installed (set REINSTALL_SMB_NODE=true to refresh after a rebuild)."
fi

# Hand off to n8n's own entrypoint.
exec /docker-entrypoint.sh "$@"
