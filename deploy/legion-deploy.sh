#!/bin/bash
# Installed at /usr/local/bin/legion-deploy on the server. Run as root via sudo from the CI runner.
# Usage: legion-deploy <path-to-legendary-vX.Y.Z.tar.gz>
set -euo pipefail

APP=/srv/legion/app
BACKUPS=/srv/legion/backups
STAGE=/srv/legion/stage
INCOMING=/srv/legion/incoming.tar.gz
PM2="/usr/local/node22/bin/pm2"
RUN="runuser -u legion -- env HOME=/srv/legion PM2_HOME=/srv/legion/.pm2 PATH=/usr/local/node22/bin:/usr/bin:/bin"

[ -f "$1" ] || { echo "usage: legion-deploy <tarball>"; exit 2; }
install -o legion -g legion -m 600 "$1" "$INCOMING"

$RUN bash -euo pipefail -c '
  APP='"$APP"'; BACKUPS='"$BACKUPS"'; STAGE='"$STAGE"'; PM2='"$PM2"'
  rm -rf "$STAGE"; mkdir -p "$STAGE" "$BACKUPS"
  tar -xzf '"$INCOMING"' -C "$STAGE" --strip-components=1
  test -f "$STAGE/dist/index.js"

  BACKUP="$BACKUPS/app-$(date +%Y%m%d-%H%M%S).tgz"
  tar -czf "$BACKUP" -C "$APP" --exclude=./match_data --exclude=./node_modules .
  ls -t "$BACKUPS"/app-*.tgz | tail -n +6 | xargs -r rm --

  install_code() {  # $1 = directory holding dist, assets, Legion, package files
    for d in dist assets Legion; do rm -rf "$APP/$d"; cp -R "$1/$d" "$APP/$d"; done
    cp "$1"/package.json "$1"/package-lock.json "$APP/"
    [ -f "$1/release-manifest.json" ] && cp "$1/release-manifest.json" "$APP/" || true
    (cd "$APP" && npm ci --omit=dev)
    $PM2 reload legion --update-env
  }
  healthy() { for i in $(seq 1 20); do curl -fsS -o /dev/null http://127.0.0.1:3100/ && return 0; sleep 1; done; return 1; }

  install_code "$STAGE"
  if healthy; then echo "deploy ok: $(grep -m1 "\"version\"" "$APP/package.json")"; exit 0; fi

  echo "health check failed, rolling back to $BACKUP" >&2
  rm -rf "$STAGE"; mkdir -p "$STAGE"; tar -xzf "$BACKUP" -C "$STAGE"
  install_code "$STAGE"
  exit 1
'
rm -f "$INCOMING"
