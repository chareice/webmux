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
    environment:
      OFFDESK_DEV_MODE: "true"
YAML
```

`!override` replaces the base file's port list instead of adding to it —
without it Compose keeps both bindings and the second one fails on the port
already being in use. It needs Compose v2.24 or newer (`docker compose
version`).

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up -d --build
```

Docker Compose merges `docker-compose.override.yml` automatically. Or skip
Docker and run the binary:

```bash
cargo build --release --bin offdesk-hub
OFFDESK_DEV_MODE=true JWT_SECRET=$(openssl rand -hex 32) \
  ./target/release/offdesk-hub --listen 0.0.0.0:4317
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

Open `http://<lan-ip>:4317` in a browser on the same machine. With
`OFFDESK_DEV_MODE=true` it signs you straight in. Go to Settings and create a
machine registration token, then:

```bash
cargo build --release --bin offdesk-node
./target/release/offdesk-node register --hub-url http://<lan-ip>:4317 --token <token>
./target/release/offdesk-node start
```

The token is single-use and expires 24 hours after it is issued.

To keep the agent running after a reboot:

```bash
./target/release/offdesk-node service install
```

That writes a systemd user unit on Linux (and runs `loginctl enable-linger` so
it survives logout), or a launchd agent on macOS.

## 3. Open it on your phone

Browse to `http://<lan-ip>:4317`. Nothing to install. Open a terminal, run
`claude`, and it is the same tmux session you would get on the desk.

Leave the desktop browser open on the same terminal if you want to watch. Both
clients see the output; whichever one types last holds the control lease, and
the other goes view-only until it types again.

## What this setup does not protect

- **`OFFDESK_DEV_MODE=true` signs in anyone who opens the URL.** The web client
  calls the dev-login endpoint on its own, with no prompt, and everyone who
  does lands on the same account. Anyone who can reach `<lan-ip>:4317` — a
  guest on your Wi-Fi, a smart TV, anything on the network — gets a shell on
  every registered machine.
- **There is no TLS.** Traffic, including the session JWT, crosses your LAN in
  the clear.
- **Do not port-forward this.** If you want the hub reachable from outside,
  turn dev mode off, configure OAuth, and put it behind TLS:
  [setup-public.md](setup-public.md).

To close the first hole without leaving the LAN, drop `OFFDESK_DEV_MODE` and
configure GitHub OAuth with `http://<lan-ip>:4317/api/auth/github/callback` as
the callback URL. GitHub accepts a plain-http callback; Google does not, except
on `localhost`.
