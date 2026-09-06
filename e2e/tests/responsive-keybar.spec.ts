import { test, expect, devices } from "@playwright/test";
import { chooseInputMode, openApp, resetMachineState, requestMachineControl, createTerminalViaApi, expandTerminalById, readTerminalBuffer } from "./helpers";

test.use({ ...devices["iPhone 14"], browserName: "chromium" });

async function setup(page: import("@playwright/test").Page) {
  await openApp(page); await resetMachineState(page); await requestMachineControl(page);
  const id = await createTerminalViaApi(page, { cwd: "/tmp", startupCommand: "env BASH_SILENCE_DEPRECATION_WARNING=1 bash --noprofile --norc" });
  await expandTerminalById(page, id);
  await expect.poll(() => readTerminalBuffer(page, id)).toMatch(/bash-\d+\.\d+[#$]/);
  return id;
}

test("equal keys and fixed inverted-T survive scrolling, folding and rotation", async ({ page }, testInfo) => {
  await setup(page);
  await chooseInputMode(page, true);
  await page.getByTestId("composer-input").fill("Preserve this draft 🦊");
  for (const width of [320, 390, 820, 960, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const bar = page.getByTestId("extended-keybar").filter({ visible: true });
    await expect(bar).toBeVisible();
    await expect(page.getByTestId("composer-input").filter({ visible: true })).toHaveValue("Preserve this draft 🦊");
    await expect.poll(async () => {
      const boxes = await bar.locator(".offdesk-terminal-key").evaluateAll(els => els.map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
      return boxes.every(box => box.width >= 44 && box.height === 44 && Math.abs(box.width - boxes[0].width) < 1);
    }).toBe(true);
    const up = bar.getByTestId("extended-keybar-up"), down = bar.getByTestId("extended-keybar-down");
    const left = bar.getByTestId("extended-keybar-left"), right = bar.getByTestId("extended-keybar-right");
    const before = await up.boundingBox();
    expect(Math.abs(before!.x - (await down.boundingBox())!.x)).toBeLessThan(1);
    expect((await left.boundingBox())!.x).toBeLessThan(before!.x);
    expect((await right.boundingBox())!.x).toBeGreaterThan(before!.x);
    const scroll = bar.getByTestId("keybar-scroll");
    await scroll.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    expect((await up.boundingBox())!.x).toBe(before!.x);
    await expect(bar.getByTestId("extended-keybar-keyboard")).toBeInViewport();
    await expect(bar.getByTestId("extended-keybar-ctrl-c")).toBeInViewport();
    await expect(bar.getByTestId("extended-keybar-tab")).toBeInViewport();
    await expect(bar.getByTestId("extended-keybar-enter")).toBeInViewport();
    await expect(bar.getByTestId("extended-keybar-shift-tab")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`keybar-${width}.png`) });
  }
});

test("local arrows and symbols edit at the caret; Enter sends once and swipe cancels activation", async ({ page }) => {
  const commands: string[] = [];
  const sends: string[] = [];
  page.on("websocket", socket => socket.on("framesent", frame => {
    if (typeof frame.payload !== "string") return;
    try { const m = JSON.parse(frame.payload); if (m.type === "command_input") commands.push(m.data); if (m.type === "composer") sends.push(frame.payload); } catch {}
  }));
  await setup(page); await chooseInputMode(page, true);
  const input = page.getByTestId("composer-input");
  await expect(input).toHaveAttribute("rows", "1");
  await input.fill("echo ab");
  await input.evaluate((el: HTMLTextAreaElement) => { el.setSelectionRange(6, 6); el.blur(); });
  await page.getByTestId("extended-keybar-left").click();
  await expect.poll(() => input.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe(5);
  await page.getByTestId("extended-keybar-slash").click();
  await expect(input).toHaveValue("echo /ab");
  await expect(input).not.toBeFocused();
  expect(commands).toEqual([]);
  // IME confirmation must not submit, while native Shift+Enter adds a line.
  await input.dispatchEvent("compositionstart");
  await page.getByTestId("extended-keybar-enter").click();
  expect(sends).toHaveLength(0);
  await input.dispatchEvent("compositionend");
  const space = page.getByTestId("extended-keybar-space");
  await space.scrollIntoViewIfNeeded();
  await space.dispatchEvent("pointerdown", { button: 0, clientX: 50, clientY: 20 });
  await space.dispatchEvent("pointermove", { clientX: 90, clientY: 20 });
  await space.dispatchEvent("pointerup");
  await space.dispatchEvent("click", { detail: 1 });
  await expect(input).toHaveValue("echo /ab");
  await input.fill("echo KEYBAR_DELIVERED");
  await input.evaluate((el: HTMLTextAreaElement) => el.blur());
  await page.getByTestId("extended-keybar-enter").click();
  await expect(input).toHaveValue("");
  expect(sends).toHaveLength(1);
  await expect(input).not.toBeFocused();
  await page.getByTestId("extended-keybar-enter").click();
  await expect.poll(() => commands).toEqual(["\r"]);
});
