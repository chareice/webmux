export const INSTALL_SCRIPT_URL =
  "https://raw.githubusercontent.com/zalify/offdesk/main/scripts/install.sh";

export function getInstallCommand(): string {
  return `curl -sSL ${INSTALL_SCRIPT_URL} | sh`;
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
