import { readConfig } from "./src/config.js";
import { createWebmuxClient } from "./src/api-client.js";
import { registerAgentTools } from "./src/tools/agents.js";
import { registerThreadTools } from "./src/tools/threads.js";
import { registerProjectTools } from "./src/tools/projects.js";

export default function register(api: any) {
  const config = readConfig(api.pluginConfig ?? {});

  if (!config.webmuxUrl || !config.webmuxToken) {
    api.logger?.warn("Webmux plugin: missing webmuxUrl or webmuxToken, skipping tool registration");
    return;
  }

  const client = createWebmuxClient(config, api.logger ?? { debug: () => {} });

  registerAgentTools(api, client);
  registerThreadTools(api, client);
  registerProjectTools(api, client);
}
