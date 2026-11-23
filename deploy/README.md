# Deploy

Production runs on 10.10.9.1 (legion.maik.io.vn): nginx -> 127.0.0.1:3100 -> PM2 process `legion` (user `legion`) in `/srv/legion/app`.

Flow: run **Cut Legion Release** (Actions) with a version. It builds both repos, publishes a GitHub Release, then the `deploy` job on the self-hosted `legion-prod` runner runs `legion-deploy`, which backs up the app, swaps the code (keeping `match_data`), reloads PM2, health-checks, and rolls back on failure.

One-time server setup: `sudo bash deploy/setup-server.sh`, then register a runner for this repo with the label `legion-prod`.
