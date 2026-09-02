import test from "node:test";
import assert from "node:assert/strict";
import worker, { apkTarget, newestAppRelease } from "./worker.js";

const releases = [
  { tag_name: "v0.18.1", html_url: "https://github.com/zalify/offdesk/releases/tag/v0.18.1", assets: [] },
  {
    tag_name: "app-v0.4.2",
    html_url: "https://github.com/zalify/offdesk/releases/tag/app-v0.4.2",
    assets: [
      { name: "offdesk-0.4.2-arm64-v8a.apk", browser_download_url: "https://github.com/zalify/offdesk/releases/download/app-v0.4.2/offdesk-0.4.2-arm64-v8a.apk" },
      { name: "offdesk-0.4.2-universal.apk", browser_download_url: "https://github.com/zalify/offdesk/releases/download/app-v0.4.2/offdesk-0.4.2-universal.apk" },
    ],
  },
  { tag_name: "app-v0.4.10", draft: true, html_url: "draft", assets: [] },
  { tag_name: "desktop-v0.3.16", html_url: "desktop", assets: [] },
  {
    tag_name: "app-v0.4.1",
    html_url: "https://github.com/zalify/offdesk/releases/tag/app-v0.4.1",
    assets: [{ name: "offdesk-0.4.1-arm64-v8a.apk", browser_download_url: "old" }],
  },
];

test("the newest app-v release wins, by version and not by listing order", () => {
  assert.equal(newestAppRelease(releases).tag_name, "app-v0.4.2");
});

test("drafts, prereleases and the hub's own releases are never the APK", () => {
  assert.equal(newestAppRelease([releases[0], releases[2], releases[3]]), null);
});

test("/apk is the arm64 file; /apk/universal the universal one; /apk/release the page", () => {
  assert.match(apkTarget(releases, "arm64-v8a"), /0\.4\.2-arm64-v8a\.apk$/);
  assert.match(apkTarget(releases, "universal"), /0\.4\.2-universal\.apk$/);
  assert.equal(apkTarget(releases, "release"), releases[1].html_url);
});

test("a flavour the release does not carry falls back to the release page", () => {
  assert.equal(apkTarget(releases, "x86_64"), releases[1].html_url);
});

test("the worker redirects /apk and leaves every other path to the static assets", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(releases), { status: 200 });
  try {
    const env = { ASSETS: { fetch: async () => new Response("static") } };
    const redirect = await worker.fetch(new Request("https://offdesk.dev/apk"), env);
    assert.equal(redirect.status, 302);
    assert.match(redirect.headers.get("location"), /arm64-v8a\.apk$/);
    const page = await worker.fetch(new Request("https://offdesk.dev/apk/release"), env);
    assert.equal(page.headers.get("location"), releases[1].html_url);
    const nope = await worker.fetch(new Request("https://offdesk.dev/apk/ios"), env);
    assert.equal(nope.status, 404);
    const site = await worker.fetch(new Request("https://offdesk.dev/"), env);
    assert.equal(await site.text(), "static");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("GitHub being down still lands on the releases list, not an error page", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("rate limited", { status: 403 });
  try {
    const env = { ASSETS: { fetch: async () => new Response("static") } };
    const response = await worker.fetch(new Request("https://offdesk.dev/apk"), env);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://github.com/zalify/offdesk/releases");
  } finally {
    globalThis.fetch = realFetch;
  }
});
