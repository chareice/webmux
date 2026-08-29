import { expect, test } from "@playwright/test";
import {
  createAgentSessionViaApi,
  openApp,
  resetMachineState,
  takeControlFromHeader,
} from "./helpers";

// Agent sessions run against the fake ACP agent (e2e/fake-acp-agent.py) —
// every agent kind in the node container's machine.json points at it. Per
// prompt it emits: thought chunk "thinking about: <text>", message chunk
// "echo: <text>", tool_call "fake tool" (in_progress) + tool_call_update
// (completed, "tool output"), then turn_ended. With FAKE_ACP_ASK=1 (set on
// the node container) a session created with auto_run=false additionally
// parks on a permission request ("fake tool", options Allow once / Allow
// always / Deny) until answered.

test("new-session dialog creates a kimi session and the chat view streams a reply", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  // Sidebar ＋ opens the new-session dialog.
  await page.getByTestId("sidebar-new-tab").click();
  await expect(page.getByTestId("new-session-dialog")).toBeVisible();
  await page.getByTestId("new-session-agent-kimi").click();
  await page.getByTestId("new-session-machine-e2e-node").click();
  await page.getByTestId("new-session-cwd-input").fill("/tmp");
  await page.getByTestId("new-session-submit").click();

  // The chat view opens full-area, routed at #/a/<id>, with a sidebar row.
  await expect(page.getByTestId("agent-chat-view")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toMatch(/^#\/a\/.+/);
  const sidebarRow = page.locator("[data-testid^='sidebar-agent-row-']");
  await expect(sidebarRow).toHaveCount(1);
  await expect(sidebarRow).toContainText("tmp");

  // Send a prompt; the fake agent echoes it back.
  await page.getByTestId("agent-chat-input").fill("hello from e2e");
  await page.getByTestId("agent-chat-send").click();
  await expect(page.getByTestId("agent-chat-stream")).toContainText(
    "echo: hello from e2e",
  );

  // The tool-call row appears and completes.
  const toolRow = page.locator("[data-testid^='agent-tool-call-fake-call-']");
  await expect(toolRow).toHaveCount(1);
  await expect(toolRow).toContainText("fake tool");
  await expect(toolRow).toContainText("completed");

  // The turn ends: status returns to idle and a turn divider renders.
  await expect(page.getByTestId("agent-chat-status")).toContainText("idle");
  await expect(page.getByTestId("agent-turn-divider")).toHaveCount(1);
});

test("auto-run off surfaces an ask-card that an option click resolves", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  const session = await createAgentSessionViaApi(page, {
    agentKind: "kimi",
    cwd: "/tmp",
    autoRun: false,
  });
  await page.getByTestId(`sidebar-agent-row-${session.id}`).click();
  await expect(page.getByTestId("agent-chat-view")).toBeVisible();

  await page.getByTestId("agent-chat-input").fill("need permission");
  await page.getByTestId("agent-chat-send").click();

  // The fake agent runs its turn, then parks on the permission request:
  // ask-card in the stream, amber inbox banner in the sidebar.
  const card = page.locator("[data-testid^='agent-ask-card-']");
  await expect(card).toBeVisible();
  await expect(card).toContainText("fake tool");
  await expect(page.getByTestId("agent-chat-stream")).toContainText(
    "echo: need permission",
  );
  await expect(page.getByTestId("agent-chat-status")).toContainText(
    "waiting on you",
  );
  await expect(page.getByTestId("sidebar-inbox")).toContainText(
    "1 waiting on you",
  );

  // Answering resolves the card, empties the inbox, and ends the turn.
  await page.getByTestId("agent-ask-option-allow-once").click();
  await expect(card).toContainText("resolved");
  await expect(page.getByTestId("sidebar-inbox")).toHaveCount(0);
  await expect(page.getByTestId("agent-chat-status")).toContainText("idle");
});

test("kill from the chat header removes the session after confirmation", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  const session = await createAgentSessionViaApi(page, {
    agentKind: "grok",
    cwd: "/tmp",
  });
  await page.getByTestId(`sidebar-agent-row-${session.id}`).click();
  await expect(page.getByTestId("agent-chat-view")).toBeVisible();

  await page.getByTestId("agent-chat-kill").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Kill session" })
    .click();

  await expect(page.getByTestId("agent-chat-view")).toHaveCount(0);
  await expect(
    page.getByTestId(`sidebar-agent-row-${session.id}`),
  ).toHaveCount(0);
});
