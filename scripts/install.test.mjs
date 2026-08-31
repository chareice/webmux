import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "webmux-install-test-"));
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents, { mode: 0o755 });
}

function runInstaller({
  os,
  arch,
  downloadBehavior = "success",
  systemctlActive = false,
  launchctlLoaded = false,
}) {
  const tempDir = makeTempDir();
  const binDir = join(tempDir, "bin");
  const installDir = join(tempDir, "install");
  mkdirSync(binDir);
  mkdirSync(installDir);

  writeExecutable(
    join(binDir, "uname"),
    `#!/bin/sh
if [ "$1" = "-s" ]; then
  printf '%s\n' '${os}'
elif [ "$1" = "-m" ]; then
  printf '%s\n' '${arch}'
else
  echo "unexpected uname args: $*" >&2
  exit 1
fi
`,
  );

  writeExecutable(
    join(binDir, "curl"),
    `#!/bin/sh
if [ "$1" = "-sSL" ] && [ "$2" = "https://api.github.com/repos/zalify/webmux/releases" ]; then
  printf '%s' '[{"tag_name":"v9.9.9"}]'
  exit 0
fi

if [ "$1" = "-sSL" ] && [ "$2" = "--fail" ] && [ "$3" = "-o" ]; then
  if [ "${downloadBehavior}" = "success" ]; then
    printf '%s' "$5" > "$4"
    exit 0
  fi

  echo "curl: (22) The requested URL returned error: 404" >&2
  exit 22
fi

echo "unexpected curl args: $*" >&2
exit 1
`,
  );

  if (systemctlActive) {
    writeExecutable(
      join(binDir, "systemctl"),
      `#!/bin/sh
if [ "$1" = "--user" ] && [ "$2" = "is-active" ] && [ "$3" = "webmux-node" ]; then
  exit 0
fi
exit 1
`,
    );
  }

  if (launchctlLoaded) {
    writeExecutable(
      join(binDir, "launchctl"),
      `#!/bin/sh
if [ "$1" = "list" ] && [ "$2" = "com.webmux.node" ]; then
  exit 0
fi
exit 1
`,
    );
  }

  const result = spawnSync("/bin/sh", ["scripts/install.sh"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: tempDir,
      PATH: `${binDir}:${process.env.PATH}`,
      WEBMUX_INSTALL_DIR: installDir,
    },
    encoding: "utf8",
  });

  const installedBinaryPath = join(installDir, "webmux-node");
  const installedBinary =
    result.status === 0 ? readFileSync(installedBinaryPath, "utf8") : null;

  return { result, installedBinary, tempDir };
}

test("install script selects the darwin arm64 binary", () => {
  const { result, installedBinary, tempDir } = runInstaller({
    os: "Darwin",
    arch: "arm64",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      installedBinary,
      "https://github.com/zalify/webmux/releases/download/v9.9.9/webmux-node-darwin-arm64",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("install script explains when the latest release is missing the current platform binary", () => {
  const { result, tempDir } = runInstaller({
    os: "Darwin",
    arch: "arm64",
    downloadBehavior: "missing-asset",
  });

  try {
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /latest release .* does not include a binary for darwin\/arm64/i,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("install script prints a restart note on darwin when the launchd service is loaded", () => {
  const { result, tempDir } = runInstaller({
    os: "Darwin",
    arch: "arm64",
    launchctlLoaded: true,
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /NOTE: webmux-node launchd service is running\. Restart to pick up the new binary:/,
    );
    assert.match(result.stdout, /webmux-node service restart/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("install script prints no restart note on darwin when the launchd service is not loaded", () => {
  const { result, tempDir } = runInstaller({
    os: "Darwin",
    arch: "arm64",
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /NOTE: webmux-node .* service is running/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("install script prints a restart note on linux when the systemd service is active", () => {
  const { result, tempDir } = runInstaller({
    os: "Linux",
    arch: "x86_64",
    systemctlActive: true,
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /NOTE: webmux-node systemd service is running\. Restart to pick up the new binary:/,
    );
    assert.match(result.stdout, /webmux-node service restart/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
