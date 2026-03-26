/**
 * Shared type definitions for the WordPress OpenClaw channel.
 */

/**
 * A chat message exchanged between a user in the WordPress editor and the agent.
 *
 * This matches the format used by the WordPress plugin sidebar — messages are
 * stored as a flat JSON array in `_claw_chat_messages` post meta.
 */
export interface ChatMessage {
  id: string;
  /** WordPress user ID (number) for human users, or username string for the agent. */
  author: number | string;
  content: string;
  timestamp: string;
  type: 'message' | 'suggestion' | 'action';
}

/** An edit suggestion proposed by the agent for a specific block in a post. */
export interface EditSuggestion {
  id: string;
  blockId: string;
  originalContent: string;
  suggestedContent: string;
  status: 'pending' | 'accepted' | 'rejected';
  reason: string;
}

/** Tracks the sync state for a single post's collaborative editing session. */
export interface PostSession {
  postId: number;
  lastSyncedMessageId: string | null;
  lastSyncTimestamp: string;
  active: boolean;
}

/** Configuration returned by the WordPress claw-agent REST endpoint. */
export interface AgentConfig {
  agentUserId: number;
  agentDisplayName: string;
  capabilities: string[];
  syncEndpoint: string;
  version: string;
}

/** A WordPress post with claw-specific meta fields. */
export interface WordPressPost {
  id: number;
  title: { rendered: string };
  content: { rendered: string };
  status: string;
  modified: string;
  modified_gmt: string;
  meta: Record<string, unknown>;
}

/**
 * The `_claw_chat_messages` meta value is a flat JSON array of ChatMessage
 * objects. This type alias makes that explicit.
 */
export type PostChatMessages = ChatMessage[];

/** Events emitted by the channel to the OpenClaw Gateway. */
export type ChannelEvent =
  | { type: 'message'; postId: number; message: ChatMessage }
  | { type: 'edit_request'; postId: number; suggestion: EditSuggestion }
  | { type: 'session_joined'; postId: number }
  | { type: 'session_left'; postId: number }
  | { type: 'error'; error: string; postId?: number };

/** Commands received from the OpenClaw Gateway. */
export type GatewayCommand =
  | { type: 'respond'; postId: number; content: string }
  | { type: 'suggest_edit'; postId: number; blockId: string; newContent: string; reason: string }
  | { type: 'join_session'; postId: number }
  | { type: 'leave_session'; postId: number };

/** The interface that all OpenClaw channel plugins must implement. */
export interface ChannelPlugin {
  id: string;
  name: string;
  version: string;
  start(config: Record<string, unknown>, emit: (event: ChannelEvent) => void): Promise<void>;
  stop(): Promise<void>;
  handleCommand(command: GatewayCommand): Promise<void>;
}
