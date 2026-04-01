export type WebmuxPluginConfig = {
  webmuxUrl?: string;
  webmuxToken?: string;
  requestTimeoutMs?: number;
};

export function readConfig(pluginConfig: Record<string, unknown>): Required<WebmuxPluginConfig> {
  const raw = (pluginConfig ?? {}) as WebmuxPluginConfig;
  return {
    webmuxUrl: (raw.webmuxUrl ?? "").replace(/\/+$/, ""),
    webmuxToken: raw.webmuxToken ?? "",
    requestTimeoutMs: raw.requestTimeoutMs ?? 30_000,
  };
}
