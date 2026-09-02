// offdesk.dev on Workers: the static site from ./dist, plus one dynamic path.
//
// /apk sends a phone to the newest Android build. GitHub's /releases/latest
// is the newest release of anything — the hub and CLI ship far more often
// than the app, so that page is never the APK. Nothing static can follow a
// tag prefix, so this resolves it at request time and redirects.
//
//   /apk            the arm64-v8a build, right for every phone made this decade
//   /apk/universal  every ABI in one file, for the unsure
//   /apk/x86_64     emulators
//   /apk/release    the release page itself, all three files and the notes

const REPO = "zalify/offdesk";
const APP_TAG = /^app-v(\d+)\.(\d+)\.(\d+)$/;
const ABIS = new Set(["arm64-v8a", "universal", "x86_64"]);

/** The newest app-v* release in a GitHub releases listing, or null. */
export function newestAppRelease(releases) {
  let best = null;
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const match = APP_TAG.exec(release.tag_name ?? "");
    if (!match) continue;
    const version = match.slice(1).map(Number);
    if (!best || compare(version, best.version) > 0) {
      best = { version, release };
    }
  }
  return best?.release ?? null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** Where /apk[/<abi>] should send someone, given the release listing. */
export function apkTarget(releases, abi) {
  const release = newestAppRelease(releases);
  if (!release) return null;
  if (abi === "release") return release.html_url;
  const asset = (release.assets ?? []).find((a) => a.name.endsWith(`-${abi}.apk`));
  return asset?.browser_download_url ?? release.html_url;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = /^\/apk(?:\/([a-z0-9_-]+))?\/?$/.exec(url.pathname);
    if (!match) return env.ASSETS.fetch(request);

    const abi = match[1] ?? "arm64-v8a";
    if (abi !== "release" && !ABIS.has(abi)) {
      return new Response("Unknown APK flavour. Try /apk, /apk/universal, /apk/x86_64 or /apk/release.\n", { status: 404 });
    }

    const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: { "user-agent": "offdesk.dev", accept: "application/vnd.github+json" },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    const target = response.ok ? apkTarget(await response.json(), abi) : null;
    return Response.redirect(target ?? `https://github.com/${REPO}/releases`, 302);
  },
};
