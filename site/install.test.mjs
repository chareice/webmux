// Tests for the script served at https://offdesk.dev/install.
//
// It lives outside `public/` on purpose: everything in there is published
// verbatim, and a test file is not part of the site.
//
// The script is driven with a fake `curl` on PATH, so nothing here touches
// the network or the real GitHub API.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const installer = fileURLToPath(new URL("public/install", import.meta.url));

function writeExecutable(path, contents) {
  writeFileSync(path, contents, { mode: 0o755 });
}

// `apiStatus` is what the fake curl reports for the releases API, and
// `assets` is the set of release files that exist. Between them they cover
// every way the installer can fail.
function run({
  args = [],
  apiStatus = 200,
  assets = [
    "offdesk-darwin-arm64",
    "offdesk-node-darwin-arm64",
    "offdesk-hub-darwin-arm64",
  ],
} = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), "offdesk-install-"));
  const binDir = join(tempDir, "bin");
  const prefix = join(tempDir, "prefix");
  mkdirSync(binDir);

  writeExecutable(
    join(binDir, "uname"),
    `#!/bin/sh
[ "$1" = "-s" ] && { echo Darwin; exit 0; }
[ "$1" = "-m" ] && { echo arm64; exit 0; }
exit 1
`,
  );
  writeExecutable(join(binDir, "tmux"), "#!/bin/sh\nexit 0\n");

  writeExecutable(
    join(binDir, "curl"),
    `#!/bin/sh
# http_status: curl -sSL -o /dev/null -w %{http_code} <url>
if [ "$1" = "-sSL" ] && [ "$2" = "-o" ]; then
  printf '%s' '${apiStatus}'
  exit 0
fi

# fetch_to: curl -fsSL -o <dest> <url>
if [ "$1" = "-fsSL" ] && [ "$2" = "-o" ]; then
  for asset in ${assets.join(" ") || '""'}; do
    case "$4" in
      *"/$asset") printf 'binary:%s' "$asset" > "$3"; exit 0 ;;
    esac
  done
  exit 22
fi

# fetch: curl -fsSL <api>
if [ "$1" = "-fsSL" ]; then
  [ "${apiStatus}" = "200" ] || exit 22
  printf '%s' '[{"tag_name":"desktop-v0.3.14"},{"tag_name":"v1.2.3"},{"tag_name":"v1.2.10"}]'
  exit 0
fi

echo "unexpected curl args: $*" >&2
exit 1
`,
  );

  const result = spawnSync("/bin/sh", [installer, "--prefix", prefix, ...args], {
    env: { ...process.env, HOME: tempDir, PATH: `${binDir}:${process.env.PATH}` },
    encoding: "utf8",
  });

  return { result, prefix, tempDir };
}

function cleanup(tempDir) {
  rmSync(tempDir, { recursive: true, force: true });
}

test("picks the newest vX.Y.Z release", () => {
  const { result, prefix, tempDir } = run();
  try {
    assert.equal(result.status, 0, result.stderr);
    // v1.2.10 over v1.2.3, and never the desktop tag.
    assert.match(result.stdout, /Installing offdesk v1\.2\.10 \(darwin\/arm64\)/);
    assert.equal(readFileSync(join(prefix, "offdesk"), "utf8"), "binary:offdesk-darwin-arm64");
    assert.equal(
      readFileSync(join(prefix, "offdesk-node"), "utf8"),
      "binary:offdesk-node-darwin-arm64",
    );
  } finally {
    cleanup(tempDir);
  }
});

test("everything is installed by default: the first machine is hub and host at once", () => {
  const { result, prefix, tempDir } = run();
  try {
    assert.equal(result.status, 0, result.stderr);
    for (const name of ["offdesk", "offdesk-node", "offdesk-hub"]) {
      assert.ok(existsSync(join(prefix, name)), `${name} should be installed`);
    }
    assert.match(result.stdout, /Next: start the hub/);
  } finally {
    cleanup(tempDir);
  }
});

test("--node-only is just the agent, for the second machine", () => {
  const { result, prefix, tempDir } = run({ args: ["--node-only"] });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(prefix, "offdesk-node")));
    assert.ok(!existsSync(join(prefix, "offdesk-hub")));
    assert.ok(!existsSync(join(prefix, "offdesk")));
  } finally {
    cleanup(tempDir);
  }
});

test("--hub-only installs the server alone", () => {
  const { result, prefix, tempDir } = run({ args: ["--hub-only"] });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(prefix, "offdesk-hub")));
    assert.ok(!existsSync(join(prefix, "offdesk")));
    assert.ok(!existsSync(join(prefix, "offdesk-node")));
  } finally {
    cleanup(tempDir);
  }
});

test("a 404 from the API is reported as a moved repository, not as a network failure", () => {
  const { result, tempDir } = run({ apiStatus: 404 });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /returned 404 — the repository is gone or renamed/);
    assert.doesNotMatch(result.stderr, /could not reach/);
  } finally {
    cleanup(tempDir);
  }
});

test("rate limiting says so instead of blaming the release", () => {
  const { result, tempDir } = run({ apiStatus: 403 });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /rate-limited/);
  } finally {
    cleanup(tempDir);
  }
});

test("a release without this platform's binary points at building from source", () => {
  const { result, tempDir } = run({ assets: ["offdesk-node-darwin-arm64"] });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release v1\.2\.10 has no offdesk-darwin-arm64/);
    assert.match(result.stderr, /cargo build --release --bin offdesk --bin offdesk-node/);
  } finally {
    cleanup(tempDir);
  }
});
