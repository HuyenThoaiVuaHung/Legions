# Deploy

Production: legion.maik.io.vn on 10.10.9.1. nginx -> 127.0.0.1:3100 -> PM2 process `legion` (user `legion`) in `/srv/legion/app`.

Flow: a push to `main` in Legions (or Legendaries, via `trigger-deploy.yml`) runs `deploy.yml`. It builds both repos' `main`, then the self-hosted `legion-prod` runner runs `legion-deploy`: backup, swap code (`match_data` is kept), reload PM2, health check, roll back on failure.

Branches: feature -> PR into `dev` -> merge `dev` into `main` to ship.

One-time setup:
1. `sudo bash deploy/setup-server.sh` on the server.
2. Register a runner for Legions with label `legion-prod`.
3. Secret `CROSS_REPO_TOKEN` (PAT with repo + workflow scope): set in Legendaries so it can dispatch the deploy. Also set it in Legions if Legendaries is private.
4. Create a `production` environment in Legions (optional approval gate).
