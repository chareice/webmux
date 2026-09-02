// Rasterise the banner, the share card and the avatar from the HTML beside
// this file, with Chrome. Run from the repo root after site/scripts/brand.mjs:
//
//   node site/scripts/brand/render.mjs
//
// The pages load Fredoka and Nunito from Google Fonts, so this needs the
// network; the SVGs and the phone screenshot come from docs/media.
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const media = join(root, "docs/media");
const types = { ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png" };

const server = createServer((req, res) => {
  const name = req.url.slice(1).split("?")[0];
  const file = [join(here, name), join(media, name)].find((f) => existsSync(f));
  if (!file) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ channel: "chrome" });
for (const [file, sel, w, h, dpr, out] of [
  ["banner.html", ".banner", 1600, 900, 2, "hero-banner.png"],
  ["og.html", ".og", 1200, 630, 1, "og-1200x630.png"],
  ["avatar.html", ".a", 400, 400, 1, "avatar-400.png"],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  await page.goto(`http://127.0.0.1:${port}/${file}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await page.locator(sel).screenshot({ path: join(media, out) });
  console.log("wrote docs/media/" + out);
  await page.close();
}
await browser.close();
server.close();
copyFileSync(join(media, "og-1200x630.png"), join(root, "site/public/brand/og-square.png"));
console.log("copied the share card to site/public/brand/og-square.png");
