import { expect, test } from "@playwright/test";
import {
  createAgentSessionViaApi,
  createTerminalViaApi,
  listWorkspaceGroupsViaApi,
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
// always / Deny) until answered. It also advertises two models
// (fake-model-a current, fake-model-b) and answers session/set_model.

test("new-session panel creates a kimi session and the chat view streams a reply", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  // Sidebar ＋ opens the new-session panel. With a single online machine the
  // machine picker is hidden; the directory is the only required input.
  await page.getByTestId("sidebar-new-tab").click();
  await expect(page.getByTestId("new-session-dialog")).toBeVisible();
  await expect(page.getByTestId("new-session-machine-e2e-node")).toHaveCount(0);
  await page.getByTestId("new-session-agent-kimi").click();
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

  // The fake agent advertises two models: the header picker shows the
  // current one and switching relays through the hub to the agent.
  const modelSelect = page.getByTestId("agent-chat-model-select");
  await expect(modelSelect).toHaveValue("fake-model-a");
  await modelSelect.selectOption("fake-model-b");
  await expect(modelSelect).toHaveValue("fake-model-b");

  // Send a prompt; the fake agent echoes it back.
  await page.getByTestId("agent-chat-input").fill("hello from e2e");
  await page.getByTestId("agent-chat-send").click();
  await expect(page.getByTestId("agent-chat-stream")).toContainText(
    "echo: hello from e2e",
  );

  // The tool-call row appears and completes.
  // Exact id: the row's children carry derived testids (-status/-content),
  // so a prefix locator would also match them.
  const toolRow = page.getByTestId("agent-tool-call-fake-call-1");
  await expect(toolRow).toHaveCount(1);
  await expect(toolRow).toContainText("fake tool");
  await expect(toolRow).toContainText("completed");

  // The turn ends: status returns to idle and a turn divider renders.
  await expect(page.getByTestId("agent-chat-status")).toContainText("idle");
  await expect(page.getByTestId("agent-turn-divider")).toHaveCount(1);
});

test("the sidebar section ＋ creates an agent chat in one click", async ({
  page,
}) => {
  await openApp(page);
  await resetMachineState(page);
  await takeControlFromHeader(page);

  // A terminal gives the sidebar a project section to create from.
  await createTerminalViaApi(page, { cwd: "/tmp" });
  const group = (await listWorkspaceGroupsViaApi(page))[0];
  const section = page.getByTestId(`sidebar-section-${group.id}`);
  await expect(section).toBeVisible();

  // Hover reveals the ＋; its menu offers an instant agent chat.
  await section.hover();
  await page.getByTestId(`sidebar-section-new-${group.id}`).click();
  await page.getByRole("button", { name: "New agent chat" }).click();

  // No dialog: the chat view opens straight away in the section's cwd.
  await expect(page.getByTestId("new-session-dialog")).toHaveCount(0);
  await expect(page.getByTestId("agent-chat-view")).toBeVisible();
  const sidebarRow = page.locator("[data-testid^='sidebar-agent-row-']");
  await expect(sidebarRow).toHaveCount(1);
  await expect(sidebarRow).toContainText("tmp");
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
