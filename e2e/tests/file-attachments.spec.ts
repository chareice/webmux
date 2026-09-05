import { createHash } from "node:crypto";
import { test, expect, devices } from "@playwright/test";
import { openApp, resetMachineState, requestMachineControl, createTerminalViaApi, expandTerminalById, readTerminalBuffer } from "./helpers";

test.use({ ...devices["iPhone 14"], browserName: "chromium" });

for (const local of [false, true]) {
  test(`${local ? "local editor" : "direct input"} uploads a named document intact through the system file picker`, async ({ page }) => {
    const script = [
      "import os,sys,tty,termios,hashlib,pathlib,shutil,shlex,time",
      "old=termios.tcgetattr(0);tty.setraw(0)",
      "sys.stdout.write('\\x1b[?2004h\\x1b[2J\\x1b[H'+'FILE_'+'READY\\r\\n');sys.stdout.flush()",
      "data=b''",
      `while not data.endswith(b'\\x1b[201~${local ? "\\r" : ""}'): data+=os.read(0,65536)`,
      "body=data.split(b'\\x1b[200~',1)[1].split(b'\\x1b[201~',1)[0].decode()",
      "path=pathlib.Path(shlex.split(body.rsplit('\\n',1)[-1])[0])",
      "contents=path.read_bytes()",
      "sys.stdout.write('\\r\\nFILE_SHA256='+hashlib.sha256(contents).hexdigest()+'\\r\\nFILE_NAME='+path.name+'\\r\\n');sys.stdout.flush()",
      "shutil.rmtree(path.parent);termios.tcsetattr(0,termios.TCSANOW,old);time.sleep(600)",
    ].join("\n");
    const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
    await openApp(page);
    await resetMachineState(page);
    await requestMachineControl(page);
    const id = await createTerminalViaApi(page, { cwd: "/tmp", startupCommand: `python3 -u -c ${quote(script)}` });
    await expandTerminalById(page, id);
    await expect.poll(() => readTerminalBuffer(page, id)).toContain("FILE_READY");
    if (local) {
      await page.getByRole("button", { name: "Local editor", exact: true }).click();
      await page.getByTestId("composer-input").fill("Please inspect this document");
      await page.getByRole("button", { name: "Attach", exact: true }).click();
    } else {
      await page.getByTestId("extended-keybar-attach").click();
    }
    const dialog = page.getByRole("dialog", { name: "Add attachment" });
    await expect(dialog.getByRole("button", { name: "Choose photos" })).toBeVisible();
    const chooserEvent = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: "Choose files" }).click();
    const chooser = await chooserEvent;
    expect(await chooser.element().getAttribute("accept")).toBeNull();
    const file = { name: "customer report's.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nBinary document \0\xff\n客户资料", "utf8") };
    await chooser.setFiles(file);
    if (local) {
      await expect(page.getByTestId("local-composer")).toContainText(file.name);
      await expect(page.getByTestId("composer-save-status")).toHaveText("Saved on this device");
      await page.reload();
      await expandTerminalById(page, id);
      await expect(page.getByTestId("local-composer")).toContainText(file.name);
      await expect(page.getByTestId("composer-input")).toHaveValue("Please inspect this document");
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Delivered to terminal");
    }
    await expect.poll(async () => (await readTerminalBuffer(page, id)).replaceAll("\n", ""))
      .toContain(`FILE_SHA256=${createHash("sha256").update(file.buffer).digest("hex")}`);
    await expect.poll(async () => (await readTerminalBuffer(page, id)).replaceAll("\n", ""))
      .toContain(`FILE_NAME=${local ? "0-" : ""}${file.name}`);
  });
}
