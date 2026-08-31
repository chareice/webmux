#!/usr/bin/env bash
# Full-stack smoke test for agent sessions: dev-mode hub + registered node
# (XDG-isolated, acp_agents overridden to e2e/fake-acp-agent.py), then a curl
# flow: claim control → create session → prompt → poll events until
# turn_ended appears → assert the echo chunk is present.
#
# No docker, no sudo. Requires: cargo build artifacts (built here), tmux,
# python3. Usage: e2e/agent-sessions-smoke.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${OFFDESK_SMOKE_PORT:-4399}"
BASE="http://127.0.0.1:$PORT"
WORK="$(mktemp -d /tmp/offdesk-agent-smoke.XXXXXX)"
HUB_LOG="$WORK/hub.log"
NODE_LOG="$WORK/node.log"
HUB_PID=""
NODE_PID=""

cleanup() {
    [ -n "$NODE_PID" ] && kill "$NODE_PID" 2>/dev/null || true
    [ -n "$HUB_PID" ] && kill "$HUB_PID" 2>/dev/null || true
    wait 2>/dev/null || true
    rm -rf "$WORK"
}
trap cleanup EXIT

json_get() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }

echo "==> building hub and node"
cargo build -q -p offdesk-hub -p offdesk-machine --manifest-path "$ROOT/Cargo.toml"
HUB_BIN="$ROOT/target/debug/offdesk-hub"
NODE_BIN="$ROOT/target/debug/offdesk-node"

echo "==> starting dev-mode hub on $BASE (db: $WORK/hub.db)"
OFFDESK_DEV_MODE=true "$HUB_BIN" --listen "127.0.0.1:$PORT" --database "$WORK/hub.db" \
    >"$HUB_LOG" 2>&1 &
HUB_PID=$!
for _ in $(seq 1 50); do
    curl -sf "$BASE/api/auth/dev" >/dev/null 2>&1 && break
    sleep 0.2
done
curl -sf "$BASE/api/auth/dev" >/dev/null || { echo "hub did not start"; cat "$HUB_LOG"; exit 1; }

TOKEN="$(curl -sf "$BASE/api/auth/dev" | json_get "['token']")"
AUTH="Authorization: Bearer $TOKEN"

echo "==> registering node (XDG_CONFIG_HOME=$WORK/xdg)"
REG_TOKEN="$(curl -sf -X POST "$BASE/api/machines/register-token" -H "$AUTH" | json_get "['token']")"
XDG_CONFIG_HOME="$WORK/xdg" "$NODE_BIN" register --hub-url "$BASE" --token "$REG_TOKEN" \
    --name smoke-node >/dev/null

# Point every agent kind at the fake ACP agent.
FAKE_AGENT="$ROOT/e2e/fake-acp-agent.py"
python3 - "$WORK/xdg/offdesk/machine.json" "$FAKE_AGENT" <<'EOF'
import json, sys
path, agent = sys.argv[1], sys.argv[2]
config = json.load(open(path))
config["acp_agents"] = {kind: ["python3", agent] for kind in ("claude", "codex", "grok", "kimi")}
json.dump(config, open(path, "w"), indent=2)
EOF

echo "==> starting node"
XDG_CONFIG_HOME="$WORK/xdg" "$NODE_BIN" start >"$NODE_LOG" 2>&1 &
NODE_PID=$!

MACHINE_ID=""
for _ in $(seq 1 50); do
    MACHINE_ID="$(curl -sf "$BASE/api/machines" -H "$AUTH" | json_get "[0]['id']" 2>/dev/null || true)"
    [ -n "$MACHINE_ID" ] && break
    sleep 0.2
done
[ -n "$MACHINE_ID" ] || { echo "node did not register with hub"; cat "$NODE_LOG"; exit 1; }
echo "    machine: $MACHINE_ID"

echo "==> claiming control lease"
curl -sf -X POST "$BASE/api/mode/control" -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"machine_id\": \"$MACHINE_ID\", \"device_id\": \"smoke-device\"}" >/dev/null

echo "==> creating agent session"
SESSION="$(curl -sf -X POST "$BASE/api/machines/$MACHINE_ID/agent-sessions" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d '{"agent_kind": "kimi", "cwd": "/tmp", "device_id": "smoke-device"}')"
SESSION_ID="$(echo "$SESSION" | json_get "['id']")"
echo "    session: $SESSION_ID (status $(echo "$SESSION" | json_get "['status']"))"

echo "==> prompting"
curl -sf -X POST "$BASE/api/machines/$MACHINE_ID/agent-sessions/$SESSION_ID/prompt" \
    -H "$AUTH" -H 'Content-Type: application/json' \
    -d '{"text": "hello smoke", "device_id": "smoke-device"}' >/dev/null

echo "==> polling events until turn_ended"
EVENTS_URL="$BASE/api/machines/$MACHINE_ID/agent-sessions/$SESSION_ID/events"
EVENTS=""
for _ in $(seq 1 150); do
    EVENTS="$(curl -sf "$EVENTS_URL" -H "$AUTH")"
    if echo "$EVENTS" | python3 -c "
import json, sys
events = json.load(sys.stdin)['events']
sys.exit(0 if any(e['event'].get('type') == 'turn_ended' for e in events) else 1)"; then
        break
    fi
    sleep 0.2
done

echo "$EVENTS" | python3 -c "
import json, sys
data = json.load(sys.stdin)
events = data['events']
kinds = [e['event'].get('type') for e in events]
assert any(k == 'turn_ended' for k in kinds), f'no turn_ended in {kinds}'
echo_chunks = [e['event'].get('text') for e in events if e['event'].get('type') == 'agent_message_chunk']
assert 'echo: hello smoke' in echo_chunks, f'no echo chunk in {echo_chunks}'
assert any(e['event'].get('type') == 'user_message' and e['event'].get('text') == 'hello smoke' for e in events), 'no user_message echo'
assert data['last_seq'] == events[-1]['seq'], 'last_seq mismatch'
print(f'    {len(events)} events, last_seq={data[\"last_seq\"]}')
"

echo "SMOKE OK"
