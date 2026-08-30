#!/usr/bin/env python3
"""Fake ACP (Agent Client Protocol) agent for tests and smoke checks.

Speaks ndjson JSON-RPC on stdio, protocolVersion 1. Implements initialize,
session/new, session/load (replays stored history as session/update
notifications), session/prompt (emits a deterministic event sequence) and
session/cancel. No network, stdlib only.

Model support (unless FAKE_ACP_MODELS=0): session/new and session/load
results carry a `models` block with two fake models (fake-model-a current,
fake-model-b); session/set_model switches the current model or answers
-32602 for an unknown model id.

Deterministic prompt flow per turn:
  1. agent_thought_chunk  "thinking about: <text>"
  2. agent_message_chunk  "echo: <text>"
  3. tool_call + tool_call_update (id "fake-call-N")
  4. if env FAKE_ACP_ASK=1: a session/request_permission request that this
     agent waits on before finishing the turn
  5. prompt response {"stopReason": "end_turn"} ("cancelled" if the turn was
     cancelled while parked on the permission request)

Special prompt texts:
  "die"  — exit immediately without responding (simulates a crashed agent).
"""

import json
import os
import sys

ASK = os.environ.get("FAKE_ACP_ASK") == "1"
MODELS_ENABLED = os.environ.get("FAKE_ACP_MODELS") != "0"

FAKE_MODELS = [
    {"modelId": "fake-model-a", "name": "Fake Model A", "description": "The default fake model"},
    {"modelId": "fake-model-b", "name": "Fake Model B"},
]

sessions = {}  # session_id -> {"cwd": str, "history": [prompt texts], "model": str}
session_counter = 0
request_counter = 0
current_session_id = None  # session being prompted, for notifications


def models_block(session):
    if not MODELS_ENABLED:
        return {}
    return {
        "models": {
            "currentModelId": session["model"],
            "availableModels": FAKE_MODELS,
        }
    }


def send(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def respond(request_id, result):
    send({"jsonrpc": "2.0", "id": request_id, "result": result})


def respond_error(request_id, code, message):
    send({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}})


def notify_update(update):
    send(
        {
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {"sessionId": current_session_id, "update": update},
        }
    )


def read_message():
    """Read one ndjson line; returns the parsed message or None on EOF."""
    line = sys.stdin.readline()
    if not line:
        return None
    line = line.strip()
    if not line:
        return {}
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return {}


def await_permission_response(request_id):
    """Wait for the response to our request_permission, honoring cancel.

    Returns "selected"/"cancelled" based on the client's answer, or
    "cancelled" when a session/cancel notification arrives first.
    """
    while True:
        message = read_message()
        if message is None:
            # Client vanished: give up the whole process.
            sys.exit(1)
        if message.get("id") == request_id and "method" not in message:
            outcome = (message.get("result") or {}).get("outcome") or {}
            return outcome.get("outcome", "cancelled")
        if message.get("method") == "session/cancel":
            return "cancelled"
        # Anything else during the wait is not expected; ignore it.


def handle_prompt(request_id, params):
    global current_session_id
    session_id = params.get("sessionId")
    session = sessions.get(session_id)
    if session is None:
        respond_error(request_id, -32602, "unknown session")
        return
    current_session_id = session_id

    text = "".join(
        block.get("text", "")
        for block in params.get("prompt", [])
        if block.get("type") == "text"
    )

    if text == "die":
        # Crash simulation: no response, no clean shutdown.
        os._exit(0)

    notify_update(
        {
            "sessionUpdate": "agent_thought_chunk",
            "content": {"type": "text", "text": f"thinking about: {text}"},
        }
    )
    notify_update(
        {
            "sessionUpdate": "agent_message_chunk",
            "content": {"type": "text", "text": f"echo: {text}"},
        }
    )
    call_id = f"fake-call-{len(session['history']) + 1}"
    notify_update(
        {
            "sessionUpdate": "tool_call",
            "toolCallId": call_id,
            "title": "fake tool",
            "kind": "other",
            "status": "in_progress",
        }
    )
    notify_update(
        {
            "sessionUpdate": "tool_call_update",
            "toolCallId": call_id,
            "status": "completed",
            "content": [
                {"type": "content", "content": {"type": "text", "text": "tool output"}}
            ],
        }
    )

    stop_reason = "end_turn"
    if ASK:
        global request_counter
        request_counter += 1
        permission_id = f"fake-permission-{request_counter}"
        send(
            {
                "jsonrpc": "2.0",
                "id": permission_id,
                "method": "session/request_permission",
                "params": {
                    "sessionId": session_id,
                    "toolCall": {"toolCallId": call_id, "title": "fake tool"},
                    "options": [
                        {
                            "optionId": "allow-once",
                            "name": "Allow once",
                            "kind": "allow_once",
                        },
                        {
                            "optionId": "allow-always",
                            "name": "Allow always",
                            "kind": "allow_always",
                        },
                        {"optionId": "deny", "name": "Deny", "kind": "deny_once"},
                    ],
                },
            }
        )
        if await_permission_response(permission_id) == "cancelled":
            stop_reason = "cancelled"

    session["history"].append(text)
    respond(request_id, {"stopReason": stop_reason})


def handle_session_load(request_id, params):
    global current_session_id
    session_id = params.get("sessionId")
    session = sessions.get(session_id)
    if session is None:
        respond_error(request_id, -32602, f"unknown session: {session_id}")
        return
    current_session_id = session_id
    # Replay stored history the way a real agent does during session/load.
    for text in session["history"]:
        notify_update(
            {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": f"echo: {text}"},
            }
        )
    respond(request_id, models_block(session))


def handle_set_model(request_id, params):
    session_id = params.get("sessionId")
    session = sessions.get(session_id)
    if session is None:
        respond_error(request_id, -32602, "unknown session")
        return
    model_id = params.get("modelId")
    if model_id not in {model["modelId"] for model in FAKE_MODELS}:
        respond_error(request_id, -32602, f"unknown model id: {model_id}")
        return
    session["model"] = model_id
    respond(request_id, {})


def main():
    global session_counter, current_session_id
    while True:
        message = read_message()
        if message is None:
            return  # stdin closed: the client is gone
        if not isinstance(message, dict):
            continue
        method = message.get("method")
        request_id = message.get("id")
        if method is None:
            continue  # a response to something we no longer track
        params = message.get("params") or {}

        if method == "initialize":
            respond(
                request_id,
                {"protocolVersion": 1, "agentCapabilities": {"loadSession": True}},
            )
        elif method == "session/new":
            session_counter += 1
            session_id = f"fake-session-{session_counter}"
            sessions[session_id] = {
                "cwd": params.get("cwd", ""),
                "history": [],
                "model": "fake-model-a",
            }
            respond(
                request_id,
                {"sessionId": session_id, **models_block(sessions[session_id])},
            )
        elif method == "session/load":
            handle_session_load(request_id, params)
        elif method == "session/set_model":
            handle_set_model(request_id, params)
        elif method == "session/prompt":
            handle_prompt(request_id, params)
        elif method == "session/cancel":
            # No prompt is in flight outside the permission wait (handled
            # there); nothing to do.
            continue
        elif request_id is not None:
            respond_error(request_id, -32601, f"method not found: {method}")


if __name__ == "__main__":
    main()
