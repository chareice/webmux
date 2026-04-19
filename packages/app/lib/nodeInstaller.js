export const INSTALL_SCRIPT_URL = "https://raw.githubusercontent.com/chareice/webmux/main/scripts/install.sh";
export function getInstallCommand() {
    return `curl -sSL ${INSTALL_SCRIPT_URL} | sh`;
}
export function getRegisterCommand(hubUrl, token) {
    return `webmux-node register --hub-url ${hubUrl} --token ${token}`;
}
export function getServiceInstallCommand() {
    return "webmux-node service install";
}
export function buildOnboardingScript(hubUrl, token) {
    return [
        getInstallCommand(),
        getRegisterCommand(hubUrl, token),
        getServiceInstallCommand(),
    ].join("\n");
}
