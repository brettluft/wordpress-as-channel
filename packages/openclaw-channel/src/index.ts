/**
 * OpenClaw Channel Plugin — WordPress
 *
 * Entry point loaded by the OpenClaw Gateway. Uses the real SDK's
 * defineChannelPluginEntry to register the WordPress channel.
 *
 * @see https://docs.openclaw.ai/plugins/sdk-channel-plugins
 */

import { defineChannelPluginEntry } from 'openclaw/plugin-sdk/core';
import { wordpressPlugin } from './plugin.js';

// ── Re-exports for programmatic use ────────────────────────────────────

export { wordpressPlugin } from './plugin.js';
export type { WordPressAccount } from './plugin.js';
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

// ── Plugin entry ───────────────────────────────────────────────────────

export default defineChannelPluginEntry({
  id: 'wordpress-channel',
  name: 'WordPress Channel',
  description: 'Connect OpenClaw to WordPress 7.0 realtime collaborative editing.',
  plugin: wordpressPlugin,
});
