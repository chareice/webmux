import { readConfig } from "./src/config.js";
import { createWebmuxClient } from "./src/api-client.js";

export default function register(api: any) {
  const config = readConfig(api.pluginConfig ?? {});

  if (!config.webmuxUrl || !config.webmuxToken) {
    api.logger?.warn("Webmux plugin: missing webmuxUrl or webmuxToken, skipping tool registration");
    return;
  }

  const client = createWebmuxClient(config, api.logger ?? { debug: () => {} });

  // Tools will be registered here in subsequent tasks
}
