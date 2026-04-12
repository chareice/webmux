# Deployment Runbook

Operational reference for webmux (terminal-canvas).

## Environments

| Environment | Host | SSH | Domains | Health URL |
|-------------|------|-----|---------|------------|
| production | NAS (Synology) | `ssh chareice@nas.chareice.site -p 10220` | `webmux.nas.chareice.site` | `https://webmux.nas.chareice.site/` |

## Services

| Service | Image / Binary | Port | Notes |
|---------|---------------|------|-------|
| webmux-server | `ghcr.io/chareice/webmux-server:main` | 4317 | Axum server + static frontend (Docker) |
| webmux-node | GitHub Release binary | — | Machine agent, systemd/launchd service on each machine |
| caddy | — | 443/80 | Reverse proxy, TLS termination |

## Paths

```
NAS:/var/services/homes/chareice/projects/
├── webmux/
│   └── docker-compose.yml        # Production compose
├── caddy/
│   └── Caddyfile                 # Reverse proxy config
```

## Reverse Proxy

Caddy config at `/var/services/homes/chareice/projects/caddy/Caddyfile`:

```
webmux.nas.chareice.site {
    reverse_proxy webmux-server-1:4317
}
```

Container uses `caddy_caddy_network` (external Docker network) for direct container-name routing.

Reload after changes:
```bash
ssh chareice@nas.chareice.site -p 10220 "export PATH=/usr/local/bin:\$PATH; docker exec caddy-caddy-1 caddy reload --config /etc/caddy/Caddyfile"
```

## Deploy

```
git push origin main
    → GitHub Actions (.github/workflows/container.yml)
    → Build Docker image (linux/amd64)
    → Push to ghcr.io/chareice/webmux-server:main
    → Manual pull & restart on NAS
```

```bash
ssh chareice@nas.chareice.site -p 10220 "export PATH=/usr/local/bin:\$PATH; cd /var/services/homes/chareice/projects/webmux && docker compose pull && docker compose up -d"
```

**CI check:**
```bash
gh run list --repo chareice/webmux --limit 5
gh run view <run-id> --repo chareice/webmux
```

## Update Machine Nodes (webmux-node)

Machine nodes are standalone binaries installed on each machine. They connect to the hub via WebSocket.

### Release a new version

Tag a release to trigger the `Build & Release` workflow:
```bash
git tag v<VERSION> && git push origin v<VERSION>
# e.g. git tag v0.3.0 && git push origin v0.3.0
```

Wait for `Build & Release` workflow to complete:
```bash
gh run list --repo chareice/webmux --workflow build.yml --limit 3
```

### Update node on a machine

SSH to the machine and re-run the install script:
```bash
curl -sSL https://raw.githubusercontent.com/chareice/webmux/main/scripts/install.sh | sh
```

Then restart the service:
```bash
# Linux (systemd)
systemctl --user restart webmux-node

# macOS (launchd)
launchctl unload ~/Library/LaunchAgents/com.webmux.node.plist
launchctl load -w ~/Library/LaunchAgents/com.webmux.node.plist
```

### Compatibility

Hub and node versions don't need to match exactly. Unknown message types are silently ignored. A newer hub with an older node just won't show resource monitoring stats — no crashes.

## Database

- **Type:** SQLite
- **Path (in container):** `/app/data/webmux.db`
- **Volume:** `webmux-data` (Docker named volume, persists across container restarts)
- **Access:**
```bash
ssh chareice@nas.chareice.site -p 10220 "export PATH=/usr/local/bin:\$PATH; docker exec webmux-server-1 sqlite3 /app/data/webmux.db '.tables'"
```

## Common Operations

### Status
```bash
ssh chareice@nas.chareice.site -p 10220 "export PATH=/usr/local/bin:\$PATH; cd /var/services/homes/chareice/projects/webmux && docker compose ps"
```

### Logs
```bash
# Recent logs
ssh chareice@nas.chareice.site -p 10220 "export PATH=/usr/local/bin:\$PATH; cd /var/services/homes/chareice/projects/webmux && docker compose logs --tail=100"

# Follow logs
ssh chareice@nas.chareice.site -p 10220 "export PATH=/usr/local/bin:\$PATH; cd /var/services/homes/chareice/projects/webmux && docker compose logs -f --tail=50"
```

### Health Check
```bash
curl -sf -o /dev/null -w "%{http_code}" https://webmux.nas.chareice.site/
# 200 = OK
```

### Restart
```bash
ssh chareice@nas.chareice.site -p 10220 "export PATH=/usr/local/bin:\$PATH; cd /var/services/homes/chareice/projects/webmux && docker compose restart"
```

### Rollback

Roll back to a specific image SHA:
```bash
# 1. Find recent image tags
gh api /user/packages/container/webmux-server/versions --jq '.[0:5] | .[] | "\(.metadata.container.tags | join(", ")) — \(.created_at)"'

# 2. Update compose to pin the sha- tag
ssh chareice@nas.chareice.site -p 10220 "export PATH=/usr/local/bin:\$PATH; cd /var/services/homes/chareice/projects/webmux && sed -i 's|image:.*|image: ghcr.io/chareice/webmux-server:sha-<COMMIT>|' docker-compose.yml && docker compose pull && docker compose up -d"

# 3. After fix is deployed, restore to :main tag
ssh chareice@nas.chareice.site -p 10220 "export PATH=/usr/local/bin:\$PATH; cd /var/services/homes/chareice/projects/webmux && sed -i 's|image:.*|image: ghcr.io/chareice/webmux-server:main|' docker-compose.yml && docker compose pull && docker compose up -d"
```

### Stop
```bash
ssh chareice@nas.chareice.site -p 10220 "export PATH=/usr/local/bin:\$PATH; cd /var/services/homes/chareice/projects/webmux && docker compose down"
```
