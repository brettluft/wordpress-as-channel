/**
 * Core WordPress channel implementation for OpenClaw.
 *
 * Connects to a WordPress site as an agent user, polls for new chat
 * messages, forwards them to the Gateway, and writes responses back.
 */

import { WPClient, WPClientError } from './wp-client.js';
import { YjsClient } from './yjs-client.js';
import type {
  ChannelEvent,
  GatewayCommand,
  ChatMessage,
  PostSession,
  EditSuggestion,
  ChannelPlugin,
} from './types.js';

export interface WordPressChannelConfig {
  siteUrl: string;
  username: string;
  appPassword: string;
  pollInterval?: number;
}

const DEFAULT_POLL_INTERVAL = 2000;
const MAX_RETRY_DELAY = 30_000;
const INITIAL_RETRY_DELAY = 1000;

export class WordPressChannel implements ChannelPlugin {
  readonly id = 'wordpress';
  readonly name = 'WordPress';
  readonly version = '0.1.0';

  private wpClient!: WPClient;
  private yjsClient!: YjsClient;
  private emit!: (event: ChannelEvent) => void;
  private config!: WordPressChannelConfig;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private sessions = new Map<number, PostSession>();
  private running = false;
  private consecutiveErrors = 0;
  private lastPollTimestamp: string | null = null;

  // -------------------------------------------------------------- lifecycle

  async start(
    rawConfig: Record<string, unknown>,
    emit: (event: ChannelEvent) => void,
  ): Promise<void> {
    this.config = validateConfig(rawConfig);
    this.emit = emit;

    this.wpClient = new WPClient({
      siteUrl: this.config.siteUrl,
      username: this.config.username,
      appPassword: this.config.appPassword,
    });

    const pollMs = this.config.pollInterval ?? DEFAULT_POLL_INTERVAL;
    this.yjsClient = new YjsClient(this.wpClient, pollMs);

    // Verify authentication
    console.log(`[WordPressChannel] Authenticating with ${this.config.siteUrl}...`);
    const auth = await this.wpClient.verifyAuth();
    console.log(
      `[WordPressChannel] Authenticated as "${auth.name}" (user ${auth.userId})`,
    );

    // Verify the claw-agent plugin is active
    try {
      const agentConfig = await this.wpClient.getConfig();
      console.log(
        `[WordPressChannel] Agent plugin v${agentConfig.version} active, capabilities: ${agentConfig.capabilities.join(', ')}`,
      );
    } catch (err) {
      if (err instanceof WPClientError && err.status === 404) {
        console.warn(
          '[WordPressChannel] claw-agent plugin endpoint not found -- running in basic mode',
        );
      } else {
        throw err;
      }
    }

    // Start polling for new messages
    this.running = true;
    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => {
        this.handlePollError(err);
      });
    }, pollMs);

    console.log(
      `[WordPressChannel] Started, polling every ${pollMs}ms`,
    );
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    await this.yjsClient.destroy();

    this.sessions.clear();
    console.log('[WordPressChannel] Stopped');
  }

  // ------------------------------------------------------------- commands

  async handleCommand(command: GatewayCommand): Promise<void> {
    switch (command.type) {
      case 'respond':
        await this.sendAgentMessage(command.postId, command.content);
        break;

      case 'suggest_edit':
        await this.suggestEdit(
          command.postId,
          command.blockId,
          command.newContent,
          command.reason,
        );
        break;

      case 'join_session':
        await this.joinPostSession(command.postId);
        break;

      case 'leave_session':
        await this.leavePostSession(command.postId);
        break;

      default: {
        const _exhaustive: never = command;
        console.warn(
          `[WordPressChannel] Unknown command type: ${(command as GatewayCommand).type}`,
        );
        void _exhaustive;
      }
    }
  }

  // --------------------------------------------------------------- polling

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      const posts = await this.wpClient.getPosts(
        this.lastPollTimestamp ?? undefined,
      );

      for (const post of posts) {
        await this.processPostMessages(post.id);
      }

      if (posts.length > 0) {
        this.lastPollTimestamp = posts[0]!.modified_gmt;
      }

      // Reset error counter on success
      this.consecutiveErrors = 0;
    } catch (err) {
      throw err; // re-throw so the caller's .catch handles it
    }
  }

  private async processPostMessages(postId: number): Promise<void> {
    const messages = await this.wpClient.getChatMessages(postId);
    if (messages.length === 0) {
      return;
    }

    let session = this.sessions.get(postId);
    if (!session) {
      session = {
        postId,
        lastSyncedMessageId: null,
        lastSyncTimestamp: new Date().toISOString(),
        active: true,
      };
      this.sessions.set(postId, session);
    }

    // Find new messages since our last sync
    const newMessages = this.getNewMessages(
      messages,
      session.lastSyncedMessageId,
    );

    for (const message of newMessages) {
      // Only forward user messages (not our own agent messages).
      // Agent messages have a string author (username), user messages have a numeric author (WP user ID).
      const isAgentMessage = typeof message.author === 'string';
      if (!isAgentMessage) {
        this.emit({ type: 'message', postId, message });
      }
      session.lastSyncedMessageId = message.id;
    }

    session.lastSyncTimestamp = new Date().toISOString();
  }

  /**
   * Return messages that come after the given lastSyncedMessageId.
   * If lastSyncedMessageId is null, return all user messages.
   */
  private getNewMessages(
    messages: ChatMessage[],
    lastSyncedMessageId: string | null,
  ): ChatMessage[] {
    if (!lastSyncedMessageId) {
      return messages;
    }

    const lastIndex = messages.findIndex((m) => m.id === lastSyncedMessageId);
    if (lastIndex === -1) {
      // ID not found -- treat all messages as new to be safe
      return messages;
    }

    return messages.slice(lastIndex + 1);
  }

  // ------------------------------------------------------- message sending

  /** Write an agent response message back to the post's chat meta. */
  private async sendAgentMessage(
    postId: number,
    content: string,
  ): Promise<void> {
    const messages = await this.wpClient.getChatMessages(postId);

    const agentMessage: ChatMessage = {
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      author: this.config.username,
      content,
      timestamp: new Date().toISOString(),
      type: 'message',
    };

    messages.push(agentMessage);
    await this.wpClient.setChatMessages(postId, messages);

    // Update our session tracking so we don't re-process our own message
    const session = this.sessions.get(postId);
    if (session) {
      session.lastSyncedMessageId = agentMessage.id;
    }
  }

  // -------------------------------------------------------- edit suggestions

  private async suggestEdit(
    postId: number,
    blockId: string,
    newContent: string,
    reason: string,
  ): Promise<void> {
    // Ensure we have a Yjs session for this post
    if (!this.yjsClient.getContent(postId).length) {
      await this.joinPostSession(postId);
    }

    // Read current block content
    const blocks = this.yjsClient.getContent(postId);
    const targetBlock = blocks.find((b) => b.blockId === blockId);

    const suggestion: EditSuggestion = {
      id: `edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      blockId,
      originalContent: targetBlock?.content ?? '',
      suggestedContent: newContent,
      status: 'pending',
      reason,
    };

    // Store the suggestion in post meta
    const existingSuggestions =
      (await this.wpClient.getPostMeta<EditSuggestion[]>(
        postId,
        '_claw_suggestions',
      )) ?? [];

    existingSuggestions.push(suggestion);
    await this.wpClient.updatePostMeta(
      postId,
      '_claw_suggestions',
      existingSuggestions,
    );

    this.emit({ type: 'edit_request', postId, suggestion });
  }

  // --------------------------------------------------------- session mgmt

  private async joinPostSession(postId: number): Promise<void> {
    await this.yjsClient.joinSession(postId);

    // Watch for content changes
    this.yjsClient.observeChanges(postId, (event) => {
      console.log(
        `[WordPressChannel] Content change in post ${event.postId}: ${event.changedKeys.join(', ')}`,
      );
    });

    this.emit({ type: 'session_joined', postId });
    console.log(`[WordPressChannel] Joined editing session for post ${postId}`);
  }

  private async leavePostSession(postId: number): Promise<void> {
    await this.yjsClient.leaveSession(postId);
    this.sessions.delete(postId);
    this.emit({ type: 'session_left', postId });
    console.log(`[WordPressChannel] Left editing session for post ${postId}`);
  }

  // ---------------------------------------------------------- error handling

  private handlePollError(err: unknown): void {
    this.consecutiveErrors++;
    const message =
      err instanceof Error ? err.message : String(err);

    console.error(
      `[WordPressChannel] Poll error (${this.consecutiveErrors}): ${message}`,
    );

    this.emit({
      type: 'error',
      error: `Poll failed: ${message}`,
    });

    // Exponential backoff: if too many consecutive errors, slow down
    if (this.consecutiveErrors >= 5 && this.pollTimer) {
      clearInterval(this.pollTimer);

      const backoffDelay = Math.min(
        INITIAL_RETRY_DELAY * Math.pow(2, this.consecutiveErrors - 5),
        MAX_RETRY_DELAY,
      );

      console.log(
        `[WordPressChannel] Backing off for ${backoffDelay}ms after ${this.consecutiveErrors} consecutive errors`,
      );

      setTimeout(() => {
        if (!this.running) return;

        this.pollTimer = setInterval(() => {
          this.poll().catch((e) => this.handlePollError(e));
        }, this.config.pollInterval ?? DEFAULT_POLL_INTERVAL);
      }, backoffDelay);
    }
  }
}

// -------------------------------------------------------------- validation

function validateConfig(
  raw: Record<string, unknown>,
): WordPressChannelConfig {
  const siteUrl = raw['siteUrl'];
  const username = raw['username'];
  const appPassword = raw['appPassword'];

  if (typeof siteUrl !== 'string' || !siteUrl) {
    throw new Error('WordPressChannel config: siteUrl is required');
  }
  if (typeof username !== 'string' || !username) {
    throw new Error('WordPressChannel config: username is required');
  }
  if (typeof appPassword !== 'string' || !appPassword) {
    throw new Error('WordPressChannel config: appPassword is required');
  }

  return {
    siteUrl,
    username,
    appPassword,
    pollInterval:
      typeof raw['pollInterval'] === 'number'
        ? raw['pollInterval']
        : undefined,
  };
}
