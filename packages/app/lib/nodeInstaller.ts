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

export function buildOnboardingScript(hubUrl: string, token: string): string {
  return [
    getInstallCommand(),
    getRegisterCommand(hubUrl, token),
    getServiceInstallCommand(),
  ].join("\n");
}
