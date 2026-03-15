#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORIGINAL_HOME="${HOME:?}"
PORT="${WEBMUX_E2E_PORT:-4417}"
BASE_URL="${WEBMUX_E2E_BASE_URL:-http://127.0.0.1:${PORT}}"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/webmux-e2e.XXXXXX")"
ARTIFACTS_DIR="${TMP_DIR}/artifacts"
AGENT_HOME="${TMP_DIR}/agent-home"
TMUX_DIR="${TMP_DIR}/tmux"
BROWSER_SESSION="webmux-e2e-$$"
SERVER_LOG="${ARTIFACTS_DIR}/server.log"
AGENT_LOG="${ARTIFACTS_DIR}/agent.log"

SERVER_PID=""
AGENT_PID=""
KEEP_ARTIFACTS=0

mkdir -p "${ARTIFACTS_DIR}" "${AGENT_HOME}" "${TMUX_DIR}"

log() {
  printf '[e2e] %s\n' "$*"
}

fail() {
  printf '[e2e] ERROR: %s\n' "$*" >&2
  KEEP_ARTIFACTS=1
  exit 1
}

cleanup() {
  local exit_code=$?

  set +e

  if [[ -n "${AGENT_PID}" ]]; then
    kill "${AGENT_PID}" >/dev/null 2>&1 || true
    wait "${AGENT_PID}" >/dev/null 2>&1 || true
  fi

  if [[ -n "${SERVER_PID}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi

  agent-browser --session-name "${BROWSER_SESSION}" close >/dev/null 2>&1 || true

  if [[ ${KEEP_ARTIFACTS} -eq 0 && ${exit_code} -eq 0 ]]; then
    node -e "require('fs').rmSync(process.argv[1], { recursive: true, force: true })" "${TMP_DIR}"
  else
    printf '[e2e] Artifacts preserved at %s\n' "${TMP_DIR}" >&2
  fi
}

trap cleanup EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

require_cmd jq
require_cmd tmux
require_cmd agent-browser
require_cmd codex
require_cmd pnpm
require_cmd curl

api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local extra_args=()

  if [[ -n "${JWT_TOKEN:-}" ]]; then
    extra_args+=(-H "Authorization: Bearer ${JWT_TOKEN}")
  fi

  if [[ -n "${data}" ]]; then
    extra_args+=(-H 'Content-Type: application/json' -d "${data}")
  fi

  curl -fsS -X "${method}" "${extra_args[@]}" "${BASE_URL}${path}"
}

api_status() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local extra_args=()

  if [[ -n "${JWT_TOKEN:-}" ]]; then
    extra_args+=(-H "Authorization: Bearer ${JWT_TOKEN}")
  fi

  if [[ -n "${data}" ]]; then
    extra_args+=(-H 'Content-Type: application/json' -d "${data}")
  fi

  curl -s -o /dev/null -w '%{http_code}' -X "${method}" "${extra_args[@]}" "${BASE_URL}${path}"
}

wait_for_http() {
  local path="$1"
  local timeout_seconds="$2"
  local started_at=$SECONDS

  until curl -fsS "${BASE_URL}${path}" >/dev/null 2>&1; do
    if (( SECONDS - started_at >= timeout_seconds )); then
      fail "Timed out waiting for ${BASE_URL}${path}"
    fi
    sleep 1
  done
}

wait_for_condition() {
  local timeout_seconds="$1"
  shift
  local started_at=$SECONDS

  until "$@"; do
    if (( SECONDS - started_at >= timeout_seconds )); then
      fail "Timed out waiting for condition: $*"
    fi
    sleep 1
  done
}

ab() {
  agent-browser --session-name "${BROWSER_SESSION}" "$@"
}

browser_snapshot() {
  ab snapshot -i --json | jq -r '.data.snapshot'
}

browser_ref() {
  local pattern="$1"
  local snapshot="$2"
  local line

  line="$(printf '%s\n' "${snapshot}" | rg -m1 "${pattern}" || true)"
  [[ -n "${line}" ]] || fail "Could not find browser element matching: ${pattern}"

  printf '%s\n' "${line}" | sed -E 's/.*\[ref=(e[0-9]+)\].*/@\1/'
}

browser_wait_for_text() {
  local needle="$1"
  local timeout_seconds="$2"
  local started_at=$SECONDS

  while true; do
    local body
    body="$(ab get text body || true)"
    if grep -Fq "${needle}" <<<"${body}"; then
      return 0
    fi

    if (( SECONDS - started_at >= timeout_seconds )); then
      fail "Timed out waiting for browser text: ${needle}"
    fi

    sleep 1
  done
}

wait_for_agent_status() {
  local expected_status="$1"

  local response
  response="$(api GET /api/agents)"
  local actual_status
  actual_status="$(printf '%s' "${response}" | jq -r '.agents[0].status // empty')"
  [[ "${actual_status}" == "${expected_status}" ]]
}

wait_for_run_output_marker() {
  local run_id="$1"
  local marker="$2"
  local output_file="$3"
  local timeout_seconds="$4"
  local started_at=$SECONDS

  while true; do
    local response
    response="$(api GET "/api/agents/${AGENT_ID}/runs/${run_id}")"
    printf '%s\n' "${response}" > "${output_file}"

    if run_detail_contains_marker "${response}" "${marker}"; then
      return 0
    fi

    if (( SECONDS - started_at >= timeout_seconds )); then
      fail "Timed out waiting for run timeline marker: ${marker}"
    fi

    sleep 2
  done
}

wait_for_run_status() {
  local run_id="$1"
  local expected_status="$2"
  local output_file="$3"
  local timeout_seconds="$4"
  local started_at=$SECONDS

  while true; do
    local response
    response="$(api GET "/api/agents/${AGENT_ID}/runs/${run_id}")"
    printf '%s\n' "${response}" > "${output_file}"

    local actual_status
    actual_status="$(printf '%s' "${response}" | jq -r '.run.status')"
    if [[ "${actual_status}" == "${expected_status}" ]]; then
      return 0
    fi

    if (( SECONDS - started_at >= timeout_seconds )); then
      fail "Timed out waiting for run ${run_id} status ${expected_status}"
    fi

    sleep 2
  done
}

run_detail_contains_marker() {
  local response="$1"
  local marker="$2"

  printf '%s' "${response}" | jq -e --arg marker "${marker}" '
    def event_text:
      if .type == "message" then
        .text
      elif .type == "command" then
        ((.command // "") + "\n" + (.output // ""))
      elif .type == "activity" then
        ((.label // "") + "\n" + (.detail // ""))
      else
        ""
      end;

    (
      (.run.summary // "") + "\n" +
      ([.items[]? | event_text] | join("\n"))
    ) | contains($marker)
  ' >/dev/null
}

log "Starting built server on ${BASE_URL}"
PORT="${PORT}" \
DATABASE_PATH="${TMP_DIR}/webmux.db" \
WEBMUX_DEV_MODE=true \
JWT_SECRET=dev-secret \
WEBMUX_BASE_URL="${BASE_URL}" \
node "${ROOT_DIR}/packages/server/dist/index.js" >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

wait_for_http /api/health 30
JWT_TOKEN="$(curl -fsS "${BASE_URL}/api/auth/dev" | jq -r '.token')"
[[ -n "${JWT_TOKEN}" && "${JWT_TOKEN}" != "null" ]] || fail 'Failed to obtain dev JWT token'

log 'Logging into the web app through the browser'
ab open "${BASE_URL}/login"
ab wait --load networkidle >/dev/null

LOGIN_BODY="$(ab get text body || true)"
if ! grep -Fq 'Your Agents' <<<"${LOGIN_BODY}"; then
  LOGIN_SNAPSHOT="$(browser_snapshot)"
  DEV_MODE_REF="$(browser_ref 'button "Dev Mode"' "${LOGIN_SNAPSHOT}")"
  ab click "${DEV_MODE_REF}" >/dev/null
fi
browser_wait_for_text 'Your Agents' 15

AGENT_BUTTON_SNAPSHOT="$(browser_snapshot)"
ADD_AGENT_REF="$(browser_ref 'button "Add your first agent"|button "Add Agent"' "${AGENT_BUTTON_SNAPSHOT}")"
ab click "${ADD_AGENT_REF}" >/dev/null
sleep 1

MODAL_TEXT="$(ab get text body)"
REGISTRATION_TOKEN="$(printf '%s\n' "${MODAL_TEXT}" | sed -nE 's/.*--token ([0-9a-f-]+).*/\1/p' | head -n 1)"
[[ -n "${REGISTRATION_TOKEN}" ]] || fail 'Failed to extract registration token from the Add Agent modal'

MODAL_SNAPSHOT="$(browser_snapshot)"
DONE_REF="$(browser_ref 'button "Done"|button "Close"' "${MODAL_SNAPSHOT}")"
ab click "${DONE_REF}" >/dev/null

log 'Registering a dedicated E2E agent with isolated HOME and tmux socket'
mkdir -p "${AGENT_HOME}/.webmux"
HOME="${AGENT_HOME}" \
TMUX_TMPDIR="${TMUX_DIR}" \
CODEX_HOME="${ORIGINAL_HOME}/.codex" \
node "${ROOT_DIR}/packages/agent/dist/cli.js" register \
  --server "${BASE_URL}" \
  --token "${REGISTRATION_TOKEN}" \
  --name e2e-agent >"${ARTIFACTS_DIR}/agent-register.log" 2>&1

HOME="${AGENT_HOME}" \
TMUX_TMPDIR="${TMUX_DIR}" \
CODEX_HOME="${ORIGINAL_HOME}/.codex" \
node "${ROOT_DIR}/packages/agent/dist/cli.js" start >"${AGENT_LOG}" 2>&1 &
AGENT_PID=$!

wait_for_condition 45 wait_for_agent_status online
AGENT_ID="$(api GET /api/agents | jq -r '.agents[0].id')"
[[ -n "${AGENT_ID}" && "${AGENT_ID}" != "null" ]] || fail 'Failed to resolve online agent id'

log 'Verifying the agent list and sessions UI'
ab open "${BASE_URL}/"
ab wait --load networkidle >/dev/null
browser_wait_for_text 'e2e-agent' 15
browser_wait_for_text 'Online' 15

ab open "${BASE_URL}/agents/${AGENT_ID}"
ab wait --load networkidle >/dev/null
SESSIONS_SNAPSHOT="$(browser_snapshot)"
NEW_SESSION_REF="$(browser_ref 'textbox "NEW SESSION"' "${SESSIONS_SNAPSHOT}")"
CREATE_REF="$(browser_ref 'button "Create"' "${SESSIONS_SNAPSHOT}")"
ab fill "${NEW_SESSION_REF}" 'e2e-shell' >/dev/null
ab click "${CREATE_REF}" >/dev/null
sleep 2

TERMINAL_SNAPSHOT="$(browser_snapshot)"
TERMINAL_INPUT_REF="$(browser_ref 'textbox "Terminal input"' "${TERMINAL_SNAPSHOT}")"
ab fill "${TERMINAL_INPUT_REF}" 'echo WEB_E2E_OK' >/dev/null
ab press Enter >/dev/null
browser_wait_for_text 'WEB_E2E_OK' 15

ab open "${BASE_URL}/agents/${AGENT_ID}?session=e2e-shell"
ab wait --load networkidle >/dev/null
browser_wait_for_text 'e2e-shell' 15

log 'Running the structured run-manager flow'
FIRST_MARKER="E2E_FIRST_${RANDOM}${RANDOM}"
RUN_DETAIL_FILE="${ARTIFACTS_DIR}/run-detail.json"

RUN_RESPONSE="$(api POST "/api/agents/${AGENT_ID}/runs" "$(jq -nc --arg tool 'codex' --arg repoPath "${ROOT_DIR}" --arg prompt "Run a shell command that prints exactly ${FIRST_MARKER}, then keep the process alive for 120 seconds so I can interrupt it." '{tool: $tool, repoPath: $repoPath, prompt: $prompt}')")"
printf '%s\n' "${RUN_RESPONSE}" > "${ARTIFACTS_DIR}/run-start.json"
RUN_ID="$(printf '%s' "${RUN_RESPONSE}" | jq -r '.run.id')"
[[ -n "${RUN_ID}" && "${RUN_ID}" != "null" ]] || fail 'Failed to start the first run'

wait_for_run_output_marker "${RUN_ID}" "${FIRST_MARKER}" "${RUN_DETAIL_FILE}" 120

api POST "/api/agents/${AGENT_ID}/runs/${RUN_ID}/interrupt" >/dev/null
wait_for_run_status "${RUN_ID}" interrupted "${RUN_DETAIL_FILE}" 60

run_detail_contains_marker "$(cat "${RUN_DETAIL_FILE}")" "${FIRST_MARKER}" || fail "Missing marker in persisted run timeline"
api DELETE "/api/agents/${AGENT_ID}/runs/${RUN_ID}" >/dev/null
[[ "$(api_status GET "/api/agents/${AGENT_ID}/runs/${RUN_ID}")" == "404" ]] || fail 'Deleted run is still accessible'

log 'Verifying disconnect handling for an active run'
DISCONNECT_MARKER="E2E_DISCONNECT_${RANDOM}${RANDOM}"
DISCONNECT_DETAIL_FILE="${ARTIFACTS_DIR}/disconnect-run-detail.json"
DISCONNECT_RESPONSE="$(api POST "/api/agents/${AGENT_ID}/runs" "$(jq -nc --arg tool 'codex' --arg repoPath "${ROOT_DIR}" --arg prompt "Run a shell command that prints exactly ${DISCONNECT_MARKER}, then keep the process alive for 120 seconds." '{tool: $tool, repoPath: $repoPath, prompt: $prompt}')")"
printf '%s\n' "${DISCONNECT_RESPONSE}" > "${ARTIFACTS_DIR}/disconnect-run-start.json"
DISCONNECT_RUN_ID="$(printf '%s' "${DISCONNECT_RESPONSE}" | jq -r '.run.id')"
[[ -n "${DISCONNECT_RUN_ID}" && "${DISCONNECT_RUN_ID}" != "null" ]] || fail 'Failed to start the disconnect run'
wait_for_run_output_marker "${DISCONNECT_RUN_ID}" "${DISCONNECT_MARKER}" "${DISCONNECT_DETAIL_FILE}" 120

kill "${AGENT_PID}" >/dev/null 2>&1 || true
wait "${AGENT_PID}" >/dev/null 2>&1 || true
AGENT_PID=""

wait_for_condition 45 wait_for_agent_status offline
wait_for_run_status "${DISCONNECT_RUN_ID}" failed "${DISCONNECT_DETAIL_FILE}" 60

DISCONNECT_SUMMARY="$(jq -r '.run.summary // empty' "${DISCONNECT_DETAIL_FILE}")"
grep -Fq 'Agent disconnected before the run completed.' <<<"${DISCONNECT_SUMMARY}" || fail 'Disconnect summary did not mention agent disconnection'

ab open "${BASE_URL}/"
ab wait --load networkidle >/dev/null
browser_wait_for_text 'Offline' 15

log 'E2E checks completed successfully'
