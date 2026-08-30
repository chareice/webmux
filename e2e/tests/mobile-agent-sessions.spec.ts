import { expect, test, devices } from "@playwright/test";
import {
  createAgentSessionViaApi,
  mobileTakeControl,
  openApp,
  resetMachineState,
} from "./helpers";

// Agent sessions on the compact shell, against the same fake ACP agent as
// agent-sessions.spec.ts (e2e/fake-acp-agent.py): per prompt it emits
// thought/message chunks ("echo: <text>"), a tool_call that completes, then
// turn_ended; with auto_run=false it additionally parks on a permission
// request (options Allow once / Allow always / Deny) until answered.

test.use({
  ...devices["iPhone 14"],
  browserName: "chromium",
});

test("an API-created session appears in the switcher sheet and its chat page streams a reply", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await mobileTakeControl(page);
  // The ＋ button's enabled state is the mobile shell's control signal —
  // wait for the lease to land before touching gated controls.
  await expect(page.getByTestId("mobile-bar-new-session")).toBeEnabled();

  const session = await createAgentSessionViaApi(page, {
    agentKind: "kimi",
    cwd: "/tmp",
  });

  // The switcher sheet lists the agent row with its badge; no close ✕
  // (kill lives in the chat title bar).
  await page.getByTestId("mobile-title-bar").click();
  await expect(page.getByTestId("mobile-session-switcher")).toBeVisible();
  const row = page.getByTestId(`mobile-agent-row-${session.id}`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId("agent-badge-kimi")).toBeVisible();
  await expect(row).toContainText("tmp");
  await expect(
    page.getByTestId(`mobile-session-close-${session.id}`),
  ).toHaveCount(0);

  // Tapping the row opens the chat page full-screen, routed at #/a/<id>;
  // the title bar carries the agent badge, title and status pill.
  await row.click();
  await expect(page.getByTestId("agent-chat-view")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toBe(`#/a/${session.id}`);
  await expect(page.getByTestId("mobile-title-bar-label")).toContainText(
    "tmp",
  );
  await expect(page.getByTestId("mobile-title-bar-status")).toBeVisible();

  // Send a prompt; the fake agent echoes it back and the turn ends.
  await page.getByTestId("agent-chat-input").fill("hello from mobile");
  await page.getByTestId("agent-chat-send").click();
  await expect(page.getByTestId("agent-chat-stream")).toContainText(
    "echo: hello from mobile",
  );
  await expect(page.getByTestId("agent-turn-divider")).toHaveCount(1);
  await expect(page.getByTestId("mobile-title-bar-status")).toContainText(
    "idle",
  );
});

test("an ask-card option tap resolves on the mobile chat page", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await mobileTakeControl(page);
  // The ＋ button's enabled state is the mobile shell's control signal —
  // wait for the lease to land before touching gated controls.
  await expect(page.getByTestId("mobile-bar-new-session")).toBeEnabled();

  const session = await createAgentSessionViaApi(page, {
    agentKind: "kimi",
    cwd: "/tmp",
    autoRun: false,
  });
  await page.getByTestId("mobile-title-bar").click();
  await page.getByTestId(`mobile-agent-row-${session.id}`).click();
  await expect(page.getByTestId("agent-chat-view")).toBeVisible();

  await page.getByTestId("agent-chat-input").fill("need permission");
  await page.getByTestId("agent-chat-send").click();

  // The fake agent runs its turn, then parks on the permission request:
  // ask-card in the stream, amber status pill in the title bar.
  const card = page.locator("[data-testid^='agent-ask-card-']");
  await expect(card).toBeVisible();
  await expect(card).toContainText("fake tool");
  await expect(page.getByTestId("mobile-title-bar-status")).toContainText(
    "waiting on you",
  );

  // Answering resolves the card and ends the turn.
  await page.getByTestId("agent-ask-option-allow-once").click();
  await expect(card).toContainText("resolved");
  await expect(page.getByTestId("mobile-title-bar-status")).toContainText(
    "idle",
  );
});

test("asked elsewhere surfaces the title-bar dot and the inbox banner jumps to the session", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await mobileTakeControl(page);
  // The ＋ button's enabled state is the mobile shell's control signal —
  // wait for the lease to land before touching gated controls.
  await expect(page.getByTestId("mobile-bar-new-session")).toBeEnabled();

  // Session A parks on a permission request inside its own chat.
  const sessionA = await createAgentSessionViaApi(page, {
    agentKind: "kimi",
    cwd: "/tmp",
    autoRun: false,
  });
  await page.getByTestId("mobile-title-bar").click();
  await page.getByTestId(`mobile-agent-row-${sessionA.id}`).click();
  await expect(page.getByTestId("agent-chat-view")).toBeVisible();
  await page.getByTestId("agent-chat-input").fill("need permission");
  await page.getByTestId("agent-chat-send").click();
  await expect(page.locator("[data-testid^='agent-ask-card-']")).toBeVisible();

  // Move to a different session's chat; A keeps waiting in the background.
  const sessionB = await createAgentSessionViaApi(page, {
    agentKind: "grok",
    cwd: "/root",
  });
  await page.getByTestId("mobile-title-bar").click();
  await page.getByTestId(`mobile-agent-row-${sessionB.id}`).click();
  await expect(page.getByTestId("agent-chat-view")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toBe(`#/a/${sessionB.id}`);

  // Amber dot on the title bar + cross-session reminder chip inside the chat.
  await expect(page.getByTestId("mobile-inbox-dot")).toBeVisible();
  const reminder = page.getByTestId("mobile-cross-reminder");
  await expect(reminder).toBeVisible();
  await expect(reminder).toContainText("1 more waiting");

  // The switcher's inbox banner reports the wait and jumps back to A.
  await page.getByTestId("mobile-title-bar").click();
  await expect(page.getByTestId("mobile-session-switcher")).toBeVisible();
  const banner = page.getByTestId("mobile-inbox-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("1 waiting on you");
  await banner.click();
  await expect(page.getByTestId("mobile-session-switcher")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toBe(`#/a/${sessionA.id}`);
  await expect(page.locator("[data-testid^='agent-ask-card-']")).toBeVisible();
});

test("the title-bar ＋ opens the new-session sheet and creates an agent session", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await mobileTakeControl(page);
  // The ＋ button's enabled state is the mobile shell's control signal —
  // wait for the lease to land before touching gated controls.
  await expect(page.getByTestId("mobile-bar-new-session")).toBeEnabled();

  await page.getByTestId("mobile-bar-new-session").click();
  const sheet = page.getByTestId("mobile-new-session-sheet");
  await expect(sheet).toBeVisible();

  // Prefilled from the remembered defaults; a single online machine hides
  // the machine picker (same rule as the desktop panel).
  await expect(
    page.getByTestId("mobile-new-session-machine-e2e-node"),
  ).toHaveCount(0);
  await page.getByTestId("mobile-new-session-agent-kimi").click();
  await page.getByTestId("mobile-new-session-cwd-input").fill("/tmp");
  const submit = page.getByTestId("mobile-new-session-submit");
  await expect(submit).toBeEnabled();
  await submit.click();

  // The chat page opens on the new session.
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId("agent-chat-view")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toMatch(/^#\/a\/.+/);
  await page.getByTestId("mobile-title-bar").click();
  await expect(
    page.locator("[data-testid^='mobile-agent-row-']"),
  ).toHaveCount(1);
});

test("kill from the chat title bar removes the session after confirmation", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await mobileTakeControl(page);
  // The ＋ button's enabled state is the mobile shell's control signal —
  // wait for the lease to land before touching gated controls.
  await expect(page.getByTestId("mobile-bar-new-session")).toBeEnabled();

  const session = await createAgentSessionViaApi(page, {
    agentKind: "grok",
    cwd: "/tmp",
  });
  await page.getByTestId("mobile-title-bar").click();
  await page.getByTestId(`mobile-agent-row-${session.id}`).click();
  await expect(page.getByTestId("agent-chat-view")).toBeVisible();

  await page.getByTestId("mobile-agent-kill").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Kill session" })
    .click();

  await expect(page.getByTestId("agent-chat-view")).toHaveCount(0);
  await page.getByTestId("mobile-title-bar").click();
  await expect(
    page.getByTestId(`mobile-agent-row-${session.id}`),
  ).toHaveCount(0);
});
