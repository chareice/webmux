import type {
  NativeZellijStatus,
  NativeZellijUnavailableStatus,
} from "@webmux/shared";

export function isNativeZellijReady(
  status: NativeZellijStatus,
): status is Extract<NativeZellijStatus, { status: "ready" }> {
  return status.status === "ready";
}

export function getNativeZellijUnavailableCopy(
  status: NativeZellijUnavailableStatus,
): { title: string; detail: string } {
  switch (status.reason) {
    case "missing_binary":
      return {
        title: "Zellij not installed",
        detail: "Install zellij on this machine and restart the node service.",
      };
    case "public_base_url_missing":
      return {
        title: "Missing Native Zellij URL",
        detail: "Set the machine public URL before opening Native Zellij.",
      };
    case "missing_tls_config":
      return {
        title: "Missing TLS configuration",
        detail: "Add the Zellij certificate and key before exposing it on the network.",
      };
    case "web_client_unavailable":
      return {
        title: "Web client unavailable",
        detail: "Install a Zellij build that includes the web client.",
      };
    case "web_server_start_failed":
      return {
        title: "Zellij web server failed",
        detail: "Check the machine logs and fix the Zellij web server startup error.",
      };
  }
}

export function nativeZellijRoute(machineId: string): string {
  return `/machines/${encodeURIComponent(machineId)}/native-zellij`;
}
