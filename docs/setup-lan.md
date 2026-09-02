# At home, off the desk

Hub on a Mac or a NAS, phone on the same Wi-Fi. Target: working in five
minutes.

This setup has no TLS and no real sign-in. It is for a network you control.
Read [What this setup does not protect](#what-this-setup-does-not-protect)
before you use it, and use [setup-public.md](setup-public.md) if the hub will
be reachable from outside your home.

## 1. Run the hub

On the machine that will hold the URL — the Mac that stays on, or the NAS:

```bash
curl -fsSL https://offdesk.dev/install | sh
offdesk-hub
offdesk-hub service install
```

The first line installs the hub, the node agent and the CLI. The second
starts the hub: it binds `0.0.0.0:4317`, keeps its database and signing key
in the offdesk config directory, and prints a link:

```
  offdesk is running at http://192.168.1.10:4317

  Open this to sign in:

    http://192.168.1.10:4317/?token=eyJhbGciOi…
```

Open that on the same machine and you are signed in. The address it prints is
the one your phone can reach: the hub lists this machine's interfaces and
takes a private address on a physical one, so a VPN or a proxy in TUN mode
does not fool it. If it still guesses wrong, start it with
`OFFDESK_BASE_URL=http://<lan-ip>:4317`.

The third line keeps it running after you close the terminal, and across
reboots — a launchd agent on macOS, a systemd user service on Linux. While it
runs it also keeps a Mac from idle-sleeping; `--allow-idle-sleep` if you would
rather it did not.

Or use Docker instead:

```bash
git clone https://github.com/zalify/offdesk && cd offdesk
```

The bundled `docker-compose.yml` binds to `127.0.0.1:4317` so a public
deployment does not expose the hub directly. Your phone cannot reach that, so
add an override file next to it:

```bash
cat > docker-compose.override.yml <<'YAML'
services:
  server:
    ports: !override ["4317:4317"]
YAML
```

`!override` replaces the base file's port list instead of adding to it —
without it Compose keeps both bindings and the second one fails on the port
already being in use. It needs Compose v2.24 or newer (`docker compose
version`).

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up -d --build
```

Then read the sign-in link out of the container's logs:

```bash
docker compose logs server | grep -A 4 "Open this to sign in"
```

Either way the point is the same: bind to `0.0.0.0`, not loopback, so the
phone can reach it. Find the machine's LAN address:

```bash
ipconfig getifaddr en0        # macOS
hostname -I | awk '{print $1}' # Linux
```

## 2. Register the machine

`offdesk-node` needs tmux. Install it first — `brew install tmux` on macOS,
`sudo apt install tmux` on Debian or Ubuntu. The agent exits at startup if tmux
is missing.

Open the sign-in link the hub printed. It lands on a page that hands you the
commands below with a registration token already in them. On the hub's own
machine the installer has already run, so skip the first line:

```bash
curl -fsSL https://offdesk.dev/install | sh -s -- --node-only
offdesk-node register --hub-url http://<lan-ip>:4317 --token <token>
offdesk-node start
```

The token is single-use and expires 24 hours after it is issued. To build
`offdesk-node` instead of installing it: [building.md](building.md).

`start` runs in the foreground and stops with the terminal. To keep the agent
running after a reboot, use this instead:

```bash
offdesk-node service install
```

That writes a systemd user unit on Linux (and runs `loginctl enable-linger` so
it survives logout), or a launchd agent on macOS.

## 3. Open it on your phone

Browse to `http://<lan-ip>:4317`. Nothing to install.

The Android app takes the same address on its first launch — a bare
`<lan-ip>:4317` is read as `http`, since a hub at home has no certificate. Open a terminal, run
`claude`, and it is the same tmux session you would get on the desk.

Leave the desktop browser open on the same terminal if you want to watch. Both
clients see the output; whichever one types last holds the control lease, and
the other goes view-only until it types again.

## What this setup does not protect

- **The sign-in link is a session in a URL.** Anyone who has it — from your
  scrollback, a screenshot, a shared terminal — signs in as the hub's owner and
  gets a shell on every registered machine. It is printed on every start until
  you configure OAuth.
- **`OFFDESK_DEV_MODE=true` is worse and should not be used here.** It signs in
  anyone who opens the URL, with no prompt and no link required.
- **There is no TLS.** Traffic, including the session JWT, crosses your LAN in
  the clear.
- **Do not port-forward this.** If you want the hub reachable from outside,
  turn dev mode off, configure OAuth, and put it behind TLS:
  [setup-public.md](setup-public.md).

To close the first hole without leaving the LAN, drop `OFFDESK_DEV_MODE` and
configure GitHub OAuth with `http://<lan-ip>:4317/api/auth/github/callback` as
the callback URL. GitHub accepts a plain-http callback; Google does not, except
on `localhost`.
