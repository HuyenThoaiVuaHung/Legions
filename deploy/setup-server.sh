#!/bin/bash
# One-time setup on the server (run with sudo). Review before running.
set -euo pipefail
install -m 755 -o root -g root "$(dirname "$0")/legion-deploy.sh" /usr/local/bin/legion-deploy
echo 'maik ALL=(root) NOPASSWD: /usr/local/bin/legion-deploy *' > /etc/sudoers.d/legion-deploy
chmod 440 /etc/sudoers.d/legion-deploy
visudo -cf /etc/sudoers.d/legion-deploy
# app/ was world-writable; only the legion user should write
chmod -R go-w /srv/legion/app
install -d -o legion -g legion -m 750 /srv/legion/backups
echo "done. Next: install a GitHub runner for Legions with label legion-prod (see deploy/README.md)."
