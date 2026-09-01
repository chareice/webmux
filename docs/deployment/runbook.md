# Deployment Runbook

Operational reference for Offdesk production.

## Identity and rename state

The application has been renamed from Webmux to Offdesk, but source/artifact
identity and production infrastructure identity are at different migration
stages. Do not infer that a repository rename also renamed the NAS Compose
project, domain, volume, or database.

| Concern | Authoritative value | State |
|---|---|---|
| GitHub repository | `zalify/offdesk` | renamed |
| Hub image | `ghcr.io/zalify/offdesk-hub` | renamed |
| Hub binary | `offdesk-hub` | renamed |
| Machine binary | `offdesk-node` | renamed for new releases |
| Production URL | `https://webmux.nas.chareice.site/` | legacy name intentionally retained |
| NAS Compose directory | `/var/services/homes/chareice/projects/webmux` | legacy name intentionally retained |
| Compose project/container | `webmux` / `webmux-server-1` | legacy name intentionally retained |
| Production volume | `webmux_webmux-data` | legacy name; must be preserved |
| Production database | `/app/data/webmux.db` | legacy name; must be preserved |
| Future Offdesk URL | `https://offdesk.nas.chareice.site/` | not live; no working TLS route yet |

The legacy production identifiers are compatibility identifiers, not stale
branding to clean up during a routine deploy. A full infrastructure rename is
a separate migration described below.

### Last verified production snapshot

Verified after production deployment on 2026-09-01:

- `https://webmux.nas.chareice.site/` returned HTTP 200.
- `webmux-server-1` was running revision
  `8a07b80be58421c8ddd8d216609bb02ab7879bcc` from
  `ghcr.io/zalify/offdesk-hub:sha-8a07b80` with zero restarts.
- The only application volume was `webmux_webmux-data`, mounted at
  `/app/data`.
- The existing tables remained present in `/app/data/webmux.db`, and both
  known machine nodes reconnected after the container recreation.
- The HTML build marker and a versioned JavaScript asset matched the deployed
  revision.
- Caddy routed `webmux.nas.chareice.site` to `webmux-server-1:4317`.
- The future `offdesk.nas.chareice.site` endpoint was not serving TLS.

The pre-cutover rollback baseline was revision
`e04694aa08dcd548f8881c330452efc38d4d2bfb` from
`ghcr.io/zalify/webmux-server:main`. Always inspect the live revision again
before a later deploy.

## Environments

There is no staging environment.

| Environment | Host | SSH | Domain | Health URL |
|---|---|---|---|---|
| production | NAS (Synology) | `ssh chareice@nas.chareice.site -p 10220` | `webmux.nas.chareice.site` | `https://webmux.nas.chareice.site/` |

Every deploy is therefore a production deploy and requires explicit user
confirmation before merging, pulling images, or restarting containers.

## Services

| Service | Image / Binary | Port | Notes |
|---|---|---|---|
| Hub | `ghcr.io/zalify/offdesk-hub:<exact-sha-tag>` | 4317 | Axum hub and static frontend. Compose service remains `server`; container remains `webmux-server-1` during compatibility deployment. |
| Machine node | `offdesk-node` for new releases | — | Standalone agents on individual machines. A hub-only deploy does not update them. |
| Caddy | `caddy:2` | 443/80 | TLS and reverse proxy. Current route keeps the legacy production hostname. |

Hub and node versions do not need to match exactly. Unknown message types are
ignored; a newer hub with an older node may omit newer capabilities but should
not crash.

## Production topology

```text
NAS:/var/services/homes/chareice/projects/
├── webmux/
│   ├── docker-compose.yml        # live production Compose file
│   └── backups/                  # deploy-time Compose and SQLite backups
└── caddy/
    └── Caddyfile                 # webmux hostname -> webmux-server-1:4317

Docker volume: webmux_webmux-data
Database:      /app/data/webmux.db
Network:       caddy_caddy_network
```

The repository's root `docker-compose.yml` describes a clean Offdesk install.
It is not a drop-in replacement for the live NAS file because a new Compose
project would create a new volume and appear to lose the existing data.

## Secrets handling

The live NAS Compose file currently contains inline JWT and OAuth credentials.

- Never print, copy into logs, or paste the full live Compose file.
- Do not run `docker compose config` without a narrow output flag; it expands
  secret values.
- Safe inspection commands include `docker compose config --services`,
  `docker compose config --images`, `docker compose ps`, and targeted
  `docker inspect` formats that only print image metadata and mounts.
- A future infrastructure migration should move these values into a
  permission-restricted `.env` file or Docker secrets, but that is separate
  from the application deploy.

## Release pipeline

Pushing or merging to `main` in `zalify/offdesk` triggers
`.github/workflows/container.yml`:

```text
main commit
  -> Publish Container Image
  -> smoke-test the runtime image
  -> publish linux/amd64 tags:
       ghcr.io/zalify/offdesk-hub:main
       ghcr.io/zalify/offdesk-hub:latest
       ghcr.io/zalify/offdesk-hub:sha-<short-commit>
```

Production must use the immutable `sha-<short-commit>` tag. Do not accept a
green workflow for one commit and then deploy a moving `:main` tag from another
commit.

## Deploy

### 1. Preflight

Confirm the PR, exact commit, CI, current production health, running image, and
mount before changing state:

```bash
gh pr view <pr-number> --repo zalify/offdesk \
  --json state,mergeable,headRefOid,statusCheckRollup,url

ssh chareice@nas.chareice.site -p 10220 \
  'export PATH=/usr/local/bin:$PATH; \
   cd /var/services/homes/chareice/projects/webmux && \
   docker compose config --services && \
   docker compose config --images && \
   docker compose ps && \
   docker inspect webmux-server-1 \
     --format "image={{.Config.Image}} id={{.Image}} revision={{index .Config.Labels \"org.opencontainers.image.revision\"}}" && \
   docker inspect webmux-server-1 \
     --format "{{range .Mounts}}{{.Name}} -> {{.Destination}}{{println}}{{end}}"'

curl -sf -o /dev/null -w '%{http_code}\n' \
  https://webmux.nas.chareice.site/
```

Expected before a routine deploy:

- health is `200`;
- container is `webmux-server-1`;
- the current image is an immutable `ghcr.io/zalify/offdesk-hub:sha-*` tag;
- volume is `webmux_webmux-data -> /app/data`;
- database remains `/app/data/webmux.db` in the live Compose file.

### 2. Merge and wait for the exact image

Merge only after explicit production confirmation:

```bash
gh pr merge <pr-number> --repo zalify/offdesk --merge

OFFDESK_DEPLOY_SHA="$(gh api repos/zalify/offdesk/commits/main --jq .sha)"
OFFDESK_IMAGE_TAG="sha-${OFFDESK_DEPLOY_SHA:0:7}"

gh run list --repo zalify/offdesk \
  --workflow container.yml \
  --commit "$OFFDESK_DEPLOY_SHA" \
  --json databaseId,headSha,status,conclusion,url
```

Watch the matching run and require success:

```bash
OFFDESK_RUN_ID=<matching-run-id>
gh run watch "$OFFDESK_RUN_ID" --repo zalify/offdesk --exit-status
docker manifest inspect \
  "ghcr.io/zalify/offdesk-hub:${OFFDESK_IMAGE_TAG}" >/dev/null
```

### 3. Back up production

Before editing, create recoverable backups on the NAS:

```bash
ssh chareice@nas.chareice.site -p 10220 \
  'set -e; \
   export PATH=/usr/local/bin:$PATH; \
   cd /var/services/homes/chareice/projects/webmux && \
   mkdir -p backups && \
   BACKUP_STAMP="$(date +%Y%m%d-%H%M%S)" && \
   BACKUP_CONTAINER="offdesk-sqlite-backup-${BACKUP_STAMP}" && \
   cp -p docker-compose.yml "backups/docker-compose.${BACKUP_STAMP}.yml" && \
   docker create --name "$BACKUP_CONTAINER" --user 0:0 \
     -v webmux_webmux-data:/data \
     keinos/sqlite3 sh -c \
       "sqlite3 /data/webmux.db \".backup /tmp/webmux.db\" && \
        sqlite3 /tmp/webmux.db \"PRAGMA integrity_check;\"" >/dev/null && \
   docker start -a "$BACKUP_CONTAINER" && \
   docker cp "$BACKUP_CONTAINER:/tmp/webmux.db" \
     "backups/webmux-${BACKUP_STAMP}.db" && \
   docker rm "$BACKUP_CONTAINER" >/dev/null && \
   test -s "backups/webmux-${BACKUP_STAMP}.db" && \
   printf "backup_stamp=%s\n" "$BACKUP_STAMP"'
```

The integrity check must print `ok`. SQLite's online backup command is used so
the snapshot also includes committed WAL data while the hub is running. The
temporary-container-plus-`docker cp` flow is required because Synology ACLs
prevent this container image from writing directly to the host `backups/`
bind mount. If a step fails after container creation, remove the named
`offdesk-sqlite-backup-<timestamp>` container before retrying.

### 4. Pin and deploy the exact image

The first compatibility cutover was completed on 2026-09-01. The live Compose
file already uses `OFFDESK_BASE_URL` and the `offdesk_hub` log filter. Routine
deploys change only the immutable Offdesk image tag.

Do not change these compatibility lines:

```text
volume:        webmux-data:/app/data
DATABASE_PATH: /app/data/webmux.db
directory:     /var/services/homes/chareice/projects/webmux
domain:        webmux.nas.chareice.site
container:     webmux-server-1
```

Replace only the immutable Offdesk image tag, then pull and recreate the hub:

```bash
OFFDESK_IMAGE_TAG=sha-<short-commit>

ssh chareice@nas.chareice.site -p 10220 \
  "export PATH=/usr/local/bin:\$PATH; \
   cd /var/services/homes/chareice/projects/webmux && \
   OFFDESK_IMAGE_TAG='$OFFDESK_IMAGE_TAG' && \
   sed -i -E \
     \"s|image: ghcr.io/zalify/offdesk-hub:sha-[0-9a-f]+|image: ghcr.io/zalify/offdesk-hub:\${OFFDESK_IMAGE_TAG}|\" \
     docker-compose.yml && \
   docker compose config --quiet && \
   docker compose config --images | \
     grep -Fxq "ghcr.io/zalify/offdesk-hub:${OFFDESK_IMAGE_TAG}" && \
   docker compose pull server && \
   docker compose up -d server"
```

## Post-deploy verification

Verify the exact running revision, stable container status, HTTP response,
recent logs, and retained database before declaring success:

```bash
ssh chareice@nas.chareice.site -p 10220 \
  'export PATH=/usr/local/bin:$PATH; \
   cd /var/services/homes/chareice/projects/webmux && \
   docker compose ps && \
   docker inspect webmux-server-1 \
     --format "image={{.Config.Image}} revision={{index .Config.Labels \"org.opencontainers.image.revision\"}} status={{.State.Status}}" && \
   docker compose logs --tail=100 server && \
   docker run --rm -v webmux_webmux-data:/data keinos/sqlite3 \
     sqlite3 /data/webmux.db '\''.tables'\'''

curl -sf -o /dev/null -w '%{http_code}\n' \
  https://webmux.nas.chareice.site/
```

Acceptance requires:

- the image label revision equals the intended full `main` commit SHA;
- the container is `Up` with no restart loop;
- the production URL returns `200`;
- recent logs show no startup panic or repeated fatal error;
- the existing SQLite tables are present.

There is no dedicated `/health` route; `/` is the current HTTP smoke check.

## Rollback

### Legacy-image rollback (temporary)

If a cutover incompatibility is discovered during the observation window,
restore the verified pre-cutover Compose backup and recreate the legacy
service. Do not pull the moving legacy tag; the verified legacy image remains
local. Do not restore the SQLite backup unless there is evidence of a database
problem.

```bash
ssh chareice@nas.chareice.site -p 10220
export PATH=/usr/local/bin:$PATH
cd /var/services/homes/chareice/projects/webmux
cp -p backups/docker-compose.20260901-204233.yml docker-compose.yml
docker compose up -d server
docker compose ps
```

Then verify `https://webmux.nas.chareice.site/` returns `200` and confirm the
running revision with `docker inspect`.

### Routine Offdesk rollback

Pin the previous known-good immutable tag, pull, and recreate:

```bash
OFFDESK_ROLLBACK_TAG=sha-<previous-short-commit>

ssh chareice@nas.chareice.site -p 10220 \
  "export PATH=/usr/local/bin:\$PATH; \
   cd /var/services/homes/chareice/projects/webmux && \
   OFFDESK_ROLLBACK_TAG='$OFFDESK_ROLLBACK_TAG' && \
   sed -i -E \
     \"s|image: ghcr.io/zalify/offdesk-hub:sha-[0-9a-f]+|image: ghcr.io/zalify/offdesk-hub:\${OFFDESK_ROLLBACK_TAG}|\" \
     docker-compose.yml && \
   docker compose config --quiet && \
   docker compose config --images | \
     grep -Fxq "ghcr.io/zalify/offdesk-hub:\${OFFDESK_ROLLBACK_TAG}" && \
   docker compose pull server && \
   docker compose up -d server"
```

## Full infrastructure rename (separate migration)

Do not combine this migration with a routine application deploy. Complete and
verify each prerequisite before changing the Compose project name or volume:

1. Create DNS and Caddy routing for `offdesk.nas.chareice.site` and prove TLS
   works while the legacy route remains available.
2. Register the new GitHub and Google OAuth callback URLs.
3. Decide whether to keep `webmux_webmux-data` as an external volume or copy
   and verify `webmux.db` into a new Offdesk-named volume.
4. Move secrets out of inline Compose configuration.
5. Create `/var/services/homes/chareice/projects/offdesk` with an explicit
   Compose project/volume strategy; do not let Compose silently create an empty
   database.
6. Start the Offdesk-named container in parallel, verify data and login, then
   switch Caddy.
7. Keep the legacy route and container rollback path until the new endpoint has
   passed an observation window.

Only after this migration should the environment table, health URL, NAS path,
container name, and database section be changed to Offdesk-native identifiers.

## Machine node releases

Bump `[workspace.package] version` in the root `Cargo.toml` first — that is
what `offdesk --version` and `offdesk-node --version` report, and a release
whose binaries disagree with its tag is worse than no version at all.

Tagging then triggers `.github/workflows/build.yml`, which builds `offdesk` and
`offdesk-node` for linux and darwin on x64 and arm64 and uploads all eight:

```bash
git tag v<VERSION>
git push origin v<VERSION>
gh run list --repo zalify/offdesk --workflow build.yml --limit 3
```

Install or update a node from the renamed repository:

```bash
curl -fsSL https://offdesk.dev/install | sh -s -- --node-only
```

Restart the node after installation:

```bash
# Linux
systemctl --user restart offdesk-node

# macOS
launchctl unload ~/Library/LaunchAgents/dev.offdesk.node.plist
launchctl load -w ~/Library/LaunchAgents/dev.offdesk.node.plist
```

## Common production operations

### Status

```bash
ssh chareice@nas.chareice.site -p 10220 \
  'export PATH=/usr/local/bin:$PATH; \
   cd /var/services/homes/chareice/projects/webmux && docker compose ps'
```

### Logs

```bash
ssh chareice@nas.chareice.site -p 10220 \
  'export PATH=/usr/local/bin:$PATH; \
   cd /var/services/homes/chareice/projects/webmux && \
   docker compose logs --tail=100 server'
```

### Health

```bash
curl -sf -o /dev/null -w '%{http_code}\n' \
  https://webmux.nas.chareice.site/
```

### Database inspection

```bash
ssh chareice@nas.chareice.site -p 10220 \
  'export PATH=/usr/local/bin:$PATH; \
   docker run --rm -v webmux_webmux-data:/data keinos/sqlite3 \
     sqlite3 /data/webmux.db '\''.tables'\'''
```

### Restart

```bash
ssh chareice@nas.chareice.site -p 10220 \
  'export PATH=/usr/local/bin:$PATH; \
   cd /var/services/homes/chareice/projects/webmux && \
   docker compose restart server'
```
