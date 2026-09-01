# GitHub repo metadata

Paste-ready values for the repository settings page. Nothing here is applied by
code — set it in the GitHub UI.

## Description

Settings → General, or the "About" gear on the repo home page.

```
Vibe code from your phone on the terminal you left at home.
```

## Website

```
https://offdesk.dev
```

## Topics

About → gear → Topics. Add each one:

```
tmux
terminal
self-hosted
claude-code
codex
ai-agents
remote-development
rust
mobile
```

## Checklist for the rename

- [x] Rename the repository to `offdesk` (Settings → General → Repository
      name). GitHub redirects the old URL, so existing clones keep working.
- [ ] Set the description and topics above.
- [ ] Set the website to `https://offdesk.dev`.
- [ ] Under About, tick "Releases" and "Packages" so the node binaries and the
      container image show on the home page.
- [ ] Create the `offdesk` Cloudflare Pages project and add the two secrets
      listed in `.github/workflows/site.yml`.
- [x] Tag a `v*` release so `https://offdesk.dev/install` has binaries to
      fetch. Done in v0.16.0, which is also the first release to carry the
      `offdesk` CLI alongside the agent.
- [ ] Check the container workflow published `ghcr.io/zalify/offdesk-hub`, and
      make the package public if the old one was.
