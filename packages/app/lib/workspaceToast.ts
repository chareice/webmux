// Minimal floating toast for workspace actions that are refused (pane cap
// reached, a failed "move pane to tab"). There is no toast system in the app
// yet; a keyboard shortcut that silently does nothing is indistinguishable
// from one that never registered, which is exactly the confusion the pane cap
// would otherwise create.
const TOAST_ID = "offdesk-workspace-toast";

export function showWorkspaceToast(message: string, timeoutMs = 3000): void {
  if (typeof document === "undefined") return;
  document.getElementById(TOAST_ID)?.remove();
  const div = document.createElement("div");
  div.id = TOAST_ID;
  div.dataset.testid = "workspace-toast";
  div.setAttribute("role", "status");
  div.style.cssText =
    "position:fixed;bottom:18px;left:50%;transform:translateX(-50%);" +
    "background:rgba(28,28,30,0.96);color:#f2f2f2;padding:9px 14px;" +
    "z-index:99999;font:12px/1.4 system-ui,sans-serif;border-radius:8px;" +
    "max-width:min(520px,88vw);text-align:center;pointer-events:auto;" +
    "cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.45);";
  div.textContent = message;
  div.addEventListener("click", () => div.remove());
  document.body.appendChild(div);
  window.setTimeout(() => {
    if (document.getElementById(TOAST_ID) === div) div.remove();
  }, timeoutMs);
}
