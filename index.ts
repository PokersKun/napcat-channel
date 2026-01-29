/**
 * NapCat (OneBot 11) Channel Plugin for Clawdbot
 * Entry point - registers the channel plugin with the Clawdbot API
 */

import type { ClawdbotPluginApi } from "./src/sdk-types.js";
import { emptyPluginConfigSchema } from "./src/sdk-types.js";
import { napcatChannelPlugin } from './src/channel.js';
import { setNapCatRuntime } from './src/runtime.js';

const plugin = {
  id: "napcat-channel",
  name: "NapCat Channel",
  description: "NapCat (OneBot 11) channel integration for Clawdbot",
  configSchema: emptyPluginConfigSchema(),
  register(api: ClawdbotPluginApi) {
    console.log('[NapCat-Channel] Registering NapCat Channel plugin');
    setNapCatRuntime(api.runtime);
    api.registerChannel({ plugin: napcatChannelPlugin });
    console.log('[NapCat-Channel] Plugin registered successfully');
  },
};

export default plugin;
