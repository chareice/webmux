import type { CreateRegistrationTokenResponse } from "@webmux/shared";

import { normalizeServerUrl } from "./auth-utils.ts";

export interface RegistrationCommandOptions {
  token: string;
  serverUrl?: string | null;
  lastServerUrl?: string | null;
  windowOrigin?: string | null;
  baseUrl?: string | null;
}

export function getRegistrationServerUrl(
  options: Omit<RegistrationCommandOptions, "token">,
): string {
  const candidate =
    options.serverUrl ??
    options.lastServerUrl ??
    options.baseUrl ??
    options.windowOrigin ??
    "";
  return normalizeServerUrl(candidate);
}

export function resolveRegistrationTokenResponse(
  response: CreateRegistrationTokenResponse,
  headerServerUrl?: string | null,
): CreateRegistrationTokenResponse {
  if (response.serverUrl) {
    return response;
  }

  if (!headerServerUrl) {
    return response;
  }

  return {
    ...response,
    serverUrl: headerServerUrl,
  };
}

export function buildInstallCommand(): string {
  return `curl -sSL https://github.com/chareice/webmux/releases/latest/download/webmux-node-linux-x64 -o ~/.local/bin/webmux-node && chmod +x ~/.local/bin/webmux-node`;
}

export function buildRegistrationCommand(
  options: RegistrationCommandOptions,
): string {
  const serverUrl = getRegistrationServerUrl(options);
  return `webmux-node register --server ${serverUrl} --token ${options.token}`;
}
