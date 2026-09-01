# Show HN

<!-- TODO(ryan): you said you'd hand me a draft and I don't have it yet.
     Send it and I'll edit it against the copy rules — proof over adjectives,
     no banned words, short sentences, nothing that isn't in docs/facts.md.

     Raw material that is already verified, if it helps you draft:

     - It is the real terminal, not a chat view. Every terminal is a tmux
       session; anything that runs in tmux runs here.
     - One hub, any number of machines, one URL. Each machine dials out over
       WebSocket, so nothing needs an inbound port.
     - Agents drive it: offdesk open / send / wait / read, from a script or
       from another agent on another machine.
     - Traffic goes through your hub. No third-party server in the path.
     - Rust. Hub is one binary plus SQLite. Machine agent is one binary.
     - The control lease: single controller per machine, last writer wins,
       everyone else stays attached and view-only.

     Things HN will ask, worth having an answer ready for:
     - Why not just ssh + tmux from Termius? (the phone keyboard, the multi
       machine list, and the agent-driving CLI)
     - What happens when the token leaks? (SECURITY.md: it is RCE on every
       registered machine; per-agent tokens, individual revoke, last-used)
     - Does it need an inbound port on my laptop? (no)
     - iOS app? (no — it is the web app in a browser; there is no iOS build) -->

## Title

TODO

## Body

TODO
