/**
 * OpenClaw Channel Plugin — WordPress
 *
 * This is the main entry point loaded by the OpenClaw Gateway.
 * It exports the channel plugin definition and all public types.
 */

import { WordPressChannel } from './channel.js';
import type { ChannelPlugin } from './types.js';

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

/**
 * The channel plugin definition that the OpenClaw Gateway loads.
 * Gateway calls `channel.start(config, emit)` to boot the channel,
 * then routes commands via `channel.handleCommand(cmd)`.
 */
const channel: ChannelPlugin = new WordPressChannel();

export default channel;
