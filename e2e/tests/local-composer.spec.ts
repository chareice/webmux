import { createHash } from "node:crypto";
import { test, expect, devices, type Page, type WebSocketRoute } from "@playwright/test";
import { openApp, resetMachineState, requestMachineControl, createTerminalViaApi, expandTerminalById, readTerminalBuffer, releaseMachineControl } from "./helpers";

test.use({ ...devices["iPhone 14"], browserName: "chromium" });

async function setup(page: Page, startupCommand = "env BASH_SILENCE_DEPRECATION_WARNING=1 bash --noprofile --norc", ready = /bash-\d+\.\d+[#$]/) {
  await openApp(page);
  await resetMachineState(page);
  await requestMachineControl(page);
  const id = await createTerminalViaApi(page, { cwd: "/tmp", startupCommand });
  await expandTerminalById(page, id);
  await expect.poll(() => readTerminalBuffer(page, id), { timeout: 20_000 }).toMatch(ready);
  await expect(page.getByRole("button", { name: "Local editor", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Local editor", exact: true }).click();
  await expect(page.getByTestId("composer-input")).toBeVisible();
  return id;
}

test("local text and images survive mode changes and reload without sending keystrokes", async ({ page }, testInfo) => {
  const frames: string[] = [];
  page.on("websocket", socket => socket.on("framesent", frame => { if (typeof frame.payload === "string") frames.push(frame.payload); }));
  const id = await setup(page);
  const framesBeforeTyping = frames.length;
  await page.getByTestId("composer-input").fill("请查看这张图片\n第二行");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=", "base64");
  await page.getByTestId("composer-photo-input").setInputFiles({ name: "example.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("img", { name: "example.png" })).toBeVisible();
  await page.getByRole("button", { name: "Direct input", exact: true }).click();
  await expect(page.getByTestId("composer-input")).toHaveCount(0);
  await page.getByRole("button", { name: "Local editor", exact: true }).click();
  await expect(page.getByTestId("composer-input")).toHaveValue("请查看这张图片\n第二行");
  expect(frames.slice(framesBeforeTyping).filter(raw => { try { return ["input", "command_input", "composer"].includes(JSON.parse(raw).type); } catch { return false; } })).toEqual([]);
  await expect(page.getByTestId("composer-save-status")).toHaveText("Saved on this device");
  await page.reload();
  await expandTerminalById(page, id);
  await expect(page.getByTestId("composer-input")).toHaveValue("请查看这张图片\n第二行");
  await expect(page.getByRole("img", { name: "example.png" })).toBeVisible();
  expect(frames.filter(raw => { try { return JSON.parse(raw).type === "composer"; } catch { return false; } })).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("local-composer.png") });
  await page.getByRole("button", { name: "/ Commands", exact: true }).click();
  await expect(page.getByTestId("composer-input")).toHaveCount(0);
  await page.getByRole("button", { name: "Local editor", exact: true }).click();
  await expect(page.getByTestId("composer-input")).toHaveValue("请查看这张图片\n第二行");
});

test("host confirms a multiline send and rejects replay of the same send ID", async ({ page }) => {
  const frames: string[] = [];
  const receipts: { id: string; status: string }[] = [];
  let terminalConnection: WebSocketRoute;
  await page.routeWebSocket(/\/ws\/terminal\//, socket => {
    const server = socket.connectToServer();
    terminalConnection = server;
    socket.onMessage(raw => {
      if (typeof raw === "string" && JSON.parse(raw).type === "composer") frames.push(raw);
      server.send(raw);
    });
    server.onMessage(raw => {
      if (typeof raw === "string" && JSON.parse(raw).type === "composer_receipt") receipts.push(JSON.parse(raw).receipt);
      socket.send(raw);
    });
  });
  const id = await setup(page);
  const marker = `COMPOSER_${Date.now()}`;
  await page.getByTestId("composer-input").fill(`printf '%s\\n' '${marker}'\nprintf '%s\\n' '第二行'`);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Delivered to terminal");
  await expect(page.getByTestId("composer-input")).toHaveValue("");
  await expect.poll(() => readTerminalBuffer(page, id)).toMatch(new RegExp(`(?:^|\\n)${marker}(?:\\n|$)`));
  await expect.poll(() => readTerminalBuffer(page, id)).toMatch(/(?:^|\n)第二行(?:\n|$)/);
  expect(frames).toHaveLength(1);
  // Reuse the exact frame, as a reconnect/status check would do. The durable
  // receipt must be returned without dispatching a second terminal write.
  const before = await readTerminalBuffer(page, id);
  await releaseMachineControl(page);
  terminalConnection!.send(frames[0]);
  await expect.poll(() => receipts.length).toBe(2);
  expect(receipts[1]).toEqual(receipts[0]);
  expect(receipts[1].status).toBe("delivered");
  expect(await readTerminalBuffer(page, id)).toBe(before);
});

test("lost acknowledgement keeps the exact draft across reload and checks delivery without a second write", async ({ page }) => {
  let dropReceipt = true;
  const frames: string[] = [];
  await page.routeWebSocket(/\/ws\/terminal\//, socket => {
    const server = socket.connectToServer();
    socket.onMessage(raw => {
      if (typeof raw === "string" && JSON.parse(raw).type === "composer") frames.push(raw);
      server.send(raw);
    });
    server.onMessage(raw => {
      if (typeof raw === "string" && JSON.parse(raw).type === "composer_receipt" && dropReceipt) {
        dropReceipt = false;
        socket.close();
        server.close();
      } else socket.send(raw);
    });
  });
  const id = await setup(page);
  const command = "printf '%s\\n' 'acknowledgement recovered'";
  await page.getByTestId("composer-input").fill(command);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Check delivery", exact: true })).toBeVisible();
  await expect(page.getByTestId("composer-input")).toHaveValue(command);
  await expect(page.getByTestId("composer-input")).toBeDisabled();
  await page.reload();
  await expandTerminalById(page, id);
  await expect(page.getByTestId("composer-input")).toHaveValue(command);
  await expect(page.getByRole("button", { name: "Check delivery", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Check delivery", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Delivered to terminal");
  await expect(page.getByTestId("composer-input")).toHaveValue("");
  expect(frames).toHaveLength(2);
  expect(frames[1]).toBe(frames[0]);
});

test("a malformed attachment fails before any text is written and keeps the draft", async ({ page }) => {
  await page.routeWebSocket(/\/ws\/terminal\//, socket => {
    const server = socket.connectToServer();
    socket.onMessage(raw => {
      if (typeof raw === "string") {
        const frame = JSON.parse(raw);
        if (frame.type === "composer") {
          frame.message.attachments = [{ mime: "image/png", data: "invalid!" }];
          server.send(JSON.stringify(frame));
          return;
        }
      }
      server.send(raw);
    });
  });
  const id = await setup(page);
  const text = `DO_NOT_WRITE_${Date.now()}`;
  await page.getByTestId("composer-input").fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("incomplete or invalid");
  await expect(page.getByTestId("composer-input")).toHaveValue(text);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  expect(await readTerminalBuffer(page, id)).not.toContain(text);
});

test("a large image reaches the machine before one complete bracketed paste and submit", async ({ page }) => {
  const script = [
    "import os,sys,tty,termios,hashlib,pathlib,shutil,time",
    "old=termios.tcgetattr(0)",
    "tty.setraw(0)",
    "sys.stdout.write('\\x1b[?2004h\\x1b[2J\\x1b[H'+'COMPOSER_'+'READY\\r\\n');sys.stdout.flush()",
    "data=b''",
    "while not data.endswith(b'\\x1b[201~\\r'): data+=os.read(0,65536)",
    "body=data.removeprefix(b'\\x1b[200~').removesuffix(b'\\x1b[201~\\r').decode()",
    "text,path=body.rsplit('\\n',1)",
    "image=pathlib.Path(path).read_bytes()",
    "sys.stdout.write('\\r\\nIMAGE_SHA256='+hashlib.sha256(image).hexdigest()+'\\r\\nTEXT_SHA256='+hashlib.sha256(text.encode()).hexdigest()+'\\r\\n');sys.stdout.flush()",
    "shutil.rmtree(pathlib.Path(path).parent)",
    "termios.tcsetattr(0,termios.TCSANOW,old)",
    "time.sleep(600)",
  ].join("\n");
  const quoted = `'${script.replaceAll("'", "'\\''")}'`;
  const id = await setup(page, `python3 -u -c ${quoted}`, /(?:^|\n)COMPOSER_READY(?:\n|$)/);
  const text = "第一行\nsecond line";
  // Base64 exceeds the former 16 MiB WebSocket frame limit.
  const bytes = Buffer.alloc(14 * 1024 * 1024, 97);
  await page.getByTestId("composer-input").fill(text);
  await page.getByTestId("composer-photo-input").setInputFiles({ name: "large.png", mimeType: "image/png", buffer: bytes });
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Delivered to terminal", { timeout: 30_000 });
  await expect.poll(async () => (await readTerminalBuffer(page, id)).replaceAll("\n", ""), { timeout: 20_000 })
    .toContain(`IMAGE_SHA256=${createHash("sha256").update(bytes).digest("hex")}`);
  await expect.poll(async () => (await readTerminalBuffer(page, id)).replaceAll("\n", ""))
    .toContain(`TEXT_SHA256=${createHash("sha256").update(text).digest("hex")}`);
  await expect(page.getByTestId("composer-input")).toHaveValue("");
  await expect(page.getByRole("img", { name: "large.png" })).toHaveCount(0);
});
