/**
 * OpenClaw Channel Plugin — WordPress
 *
 * Native OpenClaw plugin that registers WordPress as a channel.
 * The Gateway loads this via `definePluginEntry` and calls
 * `api.registerChannel()` to wire up the WordPress bridge.
 *
 * @see https://docs.openclaw.ai/tools/plugin
 */

import { definePluginEntry } from 'openclaw/plugin-sdk';
import { WordPressChannel } from './channel.js';

// ── Re-exports for programmatic use ────────────────────────────────────────

export { WordPressChannel } from './channel.js';
export type { WordPressChannelConfig } from './channel.js';
export { WPClient, WPClientError } from './wp-client.js';
export type { WPClientConfig } from './wp-client.js';
export { YjsClient } from './yjs-client.js';
export type { YjsChangeEvent, BlockContent } from './yjs-client.js';
export type {
  ChatMessage,
  EditSuggestion,
  PostSession,
  AgentConfig,
  WordPressPost,
  PostChatMessages,
  ChannelEvent,
  GatewayCommand,
  ChannelPlugin,
} from './types.js';

// ── Plugin entry ───────────────────────────────────────────────────────────

export default definePluginEntry({
  id: 'wordpress-channel',
  name: 'WordPress Channel',
  version: '0.1.0',

  register(api) {
    // Register WordPress as a channel — the Gateway reads channel config
    // from openclaw.json `channels.wordpress` and passes it to start().
    api.registerChannel(new WordPressChannel());
  },
});
