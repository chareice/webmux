// One installer, the same one https://offdesk.dev/install serves. The
// onboarding flow only wants the machine agent, which is what --node-only
// asks for; `sh -s --` is how arguments reach a script arriving on stdin.
export const INSTALL_SCRIPT_URL = "https://offdesk.dev/install";

export function getInstallCommand(): string {
  return `curl -fsSL ${INSTALL_SCRIPT_URL} | sh -s -- --node-only`;
}

export function getRegisterCommand(hubUrl: string, token: string): string {
  return `offdesk-node register --hub-url ${hubUrl} --token ${token}`;
}

export function getServiceInstallCommand(): string {
  return "offdesk-node service install";
}

// The one line the "Add host" page shows. The installer takes --hub-url and
// --token and does the rest — install the agent, register, keep it running
// as a service — so there is nothing to sequence by hand and nothing to
// forget. It re-registers a machine that already has the agent, the hub's
// own included.
export function getJoinCommand(hubUrl: string, token: string): string {
  return `curl -fsSL ${INSTALL_SCRIPT_URL} | sh -s -- --hub-url ${hubUrl} --token ${token}`;
}

export function buildOnboardingScript(hubUrl: string, token: string): string {
  return getJoinCommand(hubUrl, token);
}
