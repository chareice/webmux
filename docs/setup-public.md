# Away from home

Three ways to reach your hub from anywhere:

- **[A VPS behind Caddy](#a-vps-behind-caddy)** — a real domain, a real
  certificate, open to the internet. Sign-in is GitHub or Google OAuth.
- **[A Cloudflare Tunnel](#a-cloudflare-tunnel)** — the hub stays at home and
  opens no port. Nothing to forward, works behind CGNAT. The trade is that
  Cloudflare terminates TLS and can see your terminal traffic.
- **[Tailscale](#tailscale)** — no public exposure at all. The hub is only
  reachable from devices on your tailnet.

Who can read your keystrokes and your agents' output, on each path:

| | Traffic in the clear at |
|---|---|
| VPS behind Caddy | your own VPS |
| Cloudflare Tunnel | **Cloudflare**, then your machine |
| Tailscale | nobody — WireGuard, end to end |

That is the whole decision. A tunnel is the least work by a wide margin and the
only one of the three that needs neither a server nor a client app on your
phone; a tailnet is the only one where the sentence "no third-party server in
the path" stays literally true.

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
curl -fsSL https://offdesk.dev/install | sh -s -- --hub-url wss://offdesk.example.com/ws/machine --token <token>
```

The installer puts `offdesk-node` in `~/.local/bin`. To build it instead:
`cargo build --release --bin offdesk-node`.

`<token>` is a registration token the hub mints for one new machine: open the hub in a browser, **Add a machine** in the machine switcher (a fresh hub with no machine lands there by itself), and it shows this line with the token filled in. The line installs the agent, registers the machine and keeps the agent running as a service. It is single-use and expires after 24
hours. The machine agent dials out to the hub over WebSocket, so it needs no
inbound port and no port forwarding of its own. That is why a laptop behind NAT
works here.

## A Cloudflare Tunnel

For a hub on a NAS or a desktop at home. `cloudflared` runs next to the hub and
dials *out* to Cloudflare, which then serves your hostname over HTTPS. No port
forwarding, no dynamic-DNS, no certificate to renew, and it works behind CGNAT
where forwarding a port is not even possible.

What you give up: Cloudflare terminates TLS at its edge, so your terminal
traffic — keystrokes, source, whatever an agent prints — passes through
Cloudflare in the clear. Their network, their logs, their subpoenas. If that is
not acceptable for the machines you are registering, use the tailnet below.

You need a domain on a Cloudflare account. The free plan is enough.

### 1. Create the tunnel

Cloudflare Zero Trust dashboard → Networks → Tunnels → Create a tunnel →
**Cloudflared**. Name it, then copy the token it shows you — it is the long
string after `--token` in the install command. That token is a credential:
anyone holding it can serve traffic as your tunnel.

Add a public hostname to the tunnel:

| Field | Value |
|---|---|
| Subdomain / domain | `offdesk` / `example.com` |
| Service type | `HTTP` |
| URL | `server:4317` |

`server` is the hub's service name in `docker-compose.yml`, which is how
`cloudflared` reaches it over the compose network. The hop from Cloudflare to
your machine is inside the tunnel; the hop from `cloudflared` to the hub never
leaves the Docker network, so plain HTTP there is fine.

### 2. Hub

```bash
git clone https://github.com/zalify/offdesk && cd offdesk
```

`.env` next to `docker-compose.yml`:

```
JWT_SECRET=<output of: openssl rand -hex 32>
OFFDESK_BASE_URL=https://offdesk.example.com
TUNNEL_TOKEN=<the token from step 1>
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

```bash
chmod 600 .env
```

Register the OAuth callback URLs exactly as in [step 2 of the VPS
path](#2-oauth-callback-urls) — the hub builds them from `OFFDESK_BASE_URL`, and
nothing about a tunnel changes that. Then:

```bash
docker compose --profile tunnel up -d --build
```

The `tunnel` profile is what starts `cloudflared`; without it you get the hub
alone, still bound to `127.0.0.1:4317`. Check both are up:

```bash
docker compose --profile tunnel ps
```

```bash
curl -sf -o /dev/null -w "%{http_code}\n" https://offdesk.example.com/
```

### 3. Machines

Exactly as in the VPS path, with the tunnel hostname:

```bash
curl -fsSL https://offdesk.dev/install | sh -s -- --hub-url wss://offdesk.example.com/ws/machine --token <token>
```

A machine on the same LAN as the hub still goes out to Cloudflare and back. If
that bothers you, register it with the hub's LAN address instead — the machine
agent only needs to reach the hub, and it does not care that your phone reaches
the same hub by a different name.

### Notes

- **Sign-in is open to anyone who finds the URL**, same as the VPS path: any
  GitHub or Google account can create an account on your hub. There is no
  allowlist. Cloudflare Access can put a second login in front of the whole
  hostname, but everything that is not a browser — `offdesk-node`, the CLI, the
  Android app — then needs an Access service token of its own, and the machine
  agent has nowhere to put one. Either scope the Access policy to the browser
  paths, or leave it off and rely on the hub's own sign-in.
- **Long-lived WebSockets are fine.** Machine agents ping every 30 seconds
  (`crates/machine/src/hub_conn.rs`) and browsers ping at the application layer,
  so idle timeouts along the path do not silently drop terminals.
- **Do not use a quick tunnel** (`cloudflared tunnel --url`, the
  `*.trycloudflare.com` hostnames) for anything but a demo. The hostname changes
  every restart, which invalidates your OAuth callback URLs, every registered
  machine, and any phone that has the old one saved.

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
curl -fsSL https://offdesk.dev/install | sh -s -- --hub-url wss://<machine>.<tailnet>.ts.net/ws/machine --token <token>
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
