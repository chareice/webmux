# Away from home

Two ways to reach your hub from anywhere:

- **[A VPS behind Caddy](#a-vps-behind-caddy)** — a real domain, a real
  certificate, open to the internet. Sign-in is GitHub or Google OAuth.
- **[Tailscale](#tailscale)** — no public exposure at all. The hub is only
  reachable from devices on your tailnet.

Either way, do not run with `OFFDESK_DEV_MODE=true`. It makes the web client
sign in silently as a shared user, with no prompt, for anyone who opens the
URL. See [setup-lan.md](setup-lan.md) for what that is for.

## A VPS behind Caddy

### 1. Hub

```bash
git clone https://github.com/zalify/offdesk && cd offdesk
```

Write the environment the compose file reads, as `.env` next to
`docker-compose.yml`:

```
JWT_SECRET=<output of: openssl rand -hex 32>
OFFDESK_BASE_URL=https://offdesk.example.com
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

```bash
chmod 600 .env
```

`OFFDESK_BASE_URL` is the public origin. The hub builds its OAuth callback URLs
from it, so it must match what you register with GitHub and Google exactly —
scheme, host, no trailing slash.

Fill in at least one provider's pair (next section), then:

```bash
docker compose up -d --build
```

The compose file binds to `127.0.0.1:4317` on purpose. Caddy is what faces the
internet.

### 2. OAuth callback URLs

The hub always builds these two paths from `OFFDESK_BASE_URL`:

| Provider | Callback URL to register | Scope requested |
|---|---|---|
| GitHub | `https://offdesk.example.com/api/auth/github/callback` | `read:user` |
| Google | `https://offdesk.example.com/api/auth/google/callback` | `openid email profile` |

**GitHub** — github.com → Settings → Developer settings → OAuth Apps → New
OAuth App. Homepage URL is `https://offdesk.example.com`; Authorization
callback URL is the one in the table. Copy the Client ID, generate a client
secret, and put both in `.env` as `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.

**Google** — console.cloud.google.com → APIs & Services → Credentials → Create
credentials → OAuth client ID → Web application. Add the table's URL under
**Authorized redirect URIs**, not "Authorized JavaScript origins". Put the
client ID and secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
Google rejects plain-http redirect URIs except on `localhost`, so this path
needs the certificate working first.

Restart after editing `.env`:

```bash
docker compose up -d
```

Anyone who can complete either OAuth flow gets an account on your hub. There is
no allowlist. If that is not what you want, keep the hub on a tailnet instead.

### 3. Caddy

```caddyfile
offdesk.example.com {
	reverse_proxy 127.0.0.1:4317
}
```

That is the whole file. Caddy obtains the certificate itself, and its default
reverse proxy already forwards WebSocket upgrades, which is all the hub needs.

If Caddy runs in Docker on a shared network with the hub, target the container
name instead:

```caddyfile
offdesk.example.com {
	reverse_proxy offdesk-server-1:4317
}
```

Reload:

```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

### 4. Machines

On each machine you want to reach — tmux required:

```bash
cargo build --release --bin offdesk-node
./target/release/offdesk-node register --hub-url https://offdesk.example.com --token <token>
./target/release/offdesk-node service install
```

Create `<token>` in the hub's Settings. It is single-use and expires after 24
hours. The machine agent dials out to the hub over WebSocket, so it needs no
inbound port and no port forwarding of its own. That is why a laptop behind NAT
works here.

## Tailscale

Same hub, no public exposure. Nothing listens on the internet, so there is no
certificate to manage and no login page facing strangers.

```bash
tailscale up
```

```bash
docker compose up -d --build
```

```bash
tailscale serve --bg 4317
```

`tailscale serve` publishes it at `https://<machine>.<tailnet>.ts.net` with a
certificate Tailscale issues, reachable only by devices on your tailnet. Set
that hostname as `OFFDESK_BASE_URL` and use it for the OAuth callback URLs the
same way as above.

Do not use `tailscale funnel` here unless you mean it — funnel puts the hub on
the public internet, which is the thing this section avoids.

Machines register with the tailnet URL:

```bash
offdesk-node register --hub-url https://<machine>.<tailnet>.ts.net --token <token>
```

Your phone needs the Tailscale app and needs to be on the tailnet. That is the
trade: one more app, against a hub no stranger can reach.

## Upgrading a webmux deployment

The rename changed two things a running deployment cares about.

**The container's SQLite path.** It was `/app/data/tc.db` and is now
`/app/data/offdesk.db`. Rename the file inside the volume before the first
start, or the hub creates an empty database and every machine looks
unregistered:

```bash
docker compose down
```

```bash
docker run --rm -v webmux_webmux-data:/data alpine mv /data/tc.db /data/offdesk.db
```

Check the volume's real name first with `docker volume ls` — Compose prefixes
it with the project directory name.

**The volume name.** It was `webmux-data` and is now `offdesk-data`. Either
copy the contents across, or keep using the old volume by naming it explicitly
in an override file.

Nothing else needs a migration. `WEBMUX_*` environment variables still work
with a deprecation notice on stderr, `wmx_` API tokens still authenticate,
`offdesk-node` moves its own config directory on first run, and a node whose
tmux sessions predate the rename keeps using the old tmux socket until those
sessions are closed.
