# n8n image preloaded with the samba-client CLI that n8n-nodes-smbclient
# shells out to. The community node itself is installed at startup by
# entrypoint.sh from the source mounted at /opt/code-temp.
#
# n8n 2.x ships as a Docker Hardened Image (Alpine, no package manager), so we
# can't `apk add` directly. Instead we install samba-client in a matching plain
# Alpine and copy the resulting files (smbclient + its dependency libraries)
# into the final image.

# Declared before the first FROM so it can be used in the stage-2 FROM line.
ARG N8N_VERSION=2.29.6

# ---- Stage 1: collect smbclient + its dependency files ----
FROM alpine:3.24 AS smb
RUN set -eux; \
	apk add --no-cache samba-client 2>&1 | tee /tmp/apk.log; \
	smbclient --version; \
	mkdir -p /export; \
	# Copy every file owned by samba-client and the packages it pulled in.
	# Base Alpine packages (musl, etc.) are already in the hardened image, so
	# they never appear in the "Installing" lines and aren't copied/clobbered.
	for p in $(grep -oE 'Installing [^ ]+' /tmp/apk.log | awk '{print $2}'); do \
		apk info -L "$p" | grep -E '^(usr/|lib/|etc/)' | while read -r f; do \
			[ -e "/$f" ] || continue; \
			mkdir -p "/export/$(dirname "$f")"; \
			cp -a "/$f" "/export/$f"; \
		done; \
	done

# ---- Stage 2: n8n + smbclient ----
FROM n8nio/n8n:${N8N_VERSION}

USER root

COPY --from=smb /export/ /
# Fail the build early if smbclient can't run (missing lib, etc.).
RUN smbclient --version

COPY docker/entrypoint.sh /usr/local/bin/smbclient-node-entrypoint.sh
RUN chmod +x /usr/local/bin/smbclient-node-entrypoint.sh

USER node

ENTRYPOINT ["tini", "--", "/usr/local/bin/smbclient-node-entrypoint.sh"]
