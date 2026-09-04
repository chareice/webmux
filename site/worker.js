// offdesk.dev on Workers: the static site from ./dist, plus a few dynamic
// paths that follow a tag prefix to its newest release. GitHub's
// /releases/latest is the newest release of anything — the hub and CLI ship
// far more often than the apps, so that page is never the APK or the dmg.
// Nothing static can follow a tag prefix, so these resolve at request time.
//
//   /apk            the arm64-v8a build, right for every phone made this decade
//   /apk/universal  every ABI in one file, for the unsure
//   /apk/x86_64     emulators
//   /apk/release    the release page itself, all three files and the notes
//   /mac            the desktop app for macOS, one dmg for both chips
//   /windows        the desktop app for Windows, the .msi
//   /linux          the desktop app for Linux, the AppImage
//   /desktop        the desktop release page, every file and the notes

const REPO = "zalify/offdesk";
const APP_TAG = /^app-v(\d+)\.(\d+)\.(\d+)$/;
const DESKTOP_TAG = /^desktop-v(\d+)\.(\d+)\.(\d+)$/;
const ABIS = new Set(["arm64-v8a", "universal", "x86_64"]);
const DESKTOP_FILES = {
  mac: (name) => name.endsWith("_universal.dmg"),
  windows: (name) => name.endsWith(".msi"),
  linux: (name) => name.endsWith(".AppImage"),
};

/** The newest release whose tag matches, in a GitHub releases listing, or null. */
function newestRelease(releases, tag) {
  let best = null;
  for (const release of releases) {
    if (release.draft || release.prerelease) continue;
    const match = tag.exec(release.tag_name ?? "");
    if (!match) continue;
    const version = match.slice(1).map(Number);
    if (!best || compare(version, best.version) > 0) {
      best = { version, release };
    }
  }
  return best?.release ?? null;
}

/** The newest app-v* release, or null. */
export function newestAppRelease(releases) {
  return newestRelease(releases, APP_TAG);
}

/** The newest desktop-v* release, or null. */
export function newestDesktopRelease(releases) {
  return newestRelease(releases, DESKTOP_TAG);
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

/** Where /mac, /windows, /linux and /desktop should send someone. */
export function desktopTarget(releases, flavour) {
  const release = newestDesktopRelease(releases);
  if (!release) return null;
  if (flavour === "release") return release.html_url;
  const wanted = DESKTOP_FILES[flavour];
  const asset = wanted && (release.assets ?? []).find((a) => wanted(a.name));
  return asset?.browser_download_url ?? release.html_url;
}

async function releases() {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
    headers: { "user-agent": "offdesk.dev", accept: "application/vnd.github+json" },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  return response.ok ? await response.json() : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const fallback = `https://github.com/${REPO}/releases`;

    const apk = /^\/apk(?:\/([a-z0-9_-]+))?\/?$/.exec(url.pathname);
    if (apk) {
      const abi = apk[1] ?? "arm64-v8a";
      if (abi !== "release" && !ABIS.has(abi)) {
        return new Response("Unknown APK flavour. Try /apk, /apk/universal, /apk/x86_64 or /apk/release.\n", { status: 404 });
      }
      const listing = await releases();
      return Response.redirect((listing && apkTarget(listing, abi)) ?? fallback, 302);
    }

    const desktop = /^\/(mac|windows|linux|desktop)\/?$/.exec(url.pathname);
    if (desktop) {
      const flavour = desktop[1] === "desktop" ? "release" : desktop[1];
      const listing = await releases();
      return Response.redirect((listing && desktopTarget(listing, flavour)) ?? fallback, 302);
    }

    return env.ASSETS.fetch(request);
  },
};
