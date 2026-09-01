# offdesk.dev

The one-page site. Astro, no framework components, no client-side framework.

```bash
pnpm install
pnpm dev      # http://localhost:4321
pnpm build    # -> site/dist
```

`site/public/` is copied to the root of the output, so `public/install` is
served at `https://offdesk.dev/install` and `public/media/hero.gif` at
`/media/hero.gif`.

Deployed by `.github/workflows/site.yml` on push to `main`.
