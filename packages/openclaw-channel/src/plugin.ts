/**
 * WordPress channel plugin — built with createChatChannelPlugin.
 *
 * This follows the OpenClaw channel plugin contract:
 *   config.resolveAccount → reads credentials from config.channels.wordpress
 *   outbound.sendText → writes agent messages to WP post meta
 *   security/pairing/threading → minimal defaults for MVP
 *
 * Inbound message polling is started via registerFull → api.registerHttpRoute
 * or can be kicked off externally.
 */

// Import the real SDK builders.
import { createChatChannelPlugin } from 'openclaw/plugin-sdk/core';
import type { ChannelSetupAdapter } from 'openclaw/plugin-sdk/channels';
import { WPClient } from './wp-client.js';
import type { ChatMessage } from './types.js';

// ── Account type ────────────────────────────────────────────────────────

export interface WordPressAccount {
  accountId: string | null;
  siteUrl: string;
  username: string;
  appPassword: string;
  pollInterval: number;
  allowFrom: string[];
  dmPolicy: string | undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function getSection(cfg: any): Record<string, unknown> | undefined {
  const channels = cfg.channels as Record<string, Record<string, unknown>> | undefined;
  return channels?.['wordpress'];
}

function resolveAccount(
  cfg: any,
  accountId?: string | null,
): WordPressAccount {
  const section = getSection(cfg);
  const siteUrl = section?.['siteUrl'] as string | undefined;
  const username = section?.['username'] as string | undefined;
  const appPassword = section?.['appPassword'] as string | undefined;

  if (!siteUrl) throw new Error('wordpress: siteUrl is required in channels.wordpress');
  if (!username) throw new Error('wordpress: username is required in channels.wordpress');
  if (!appPassword) throw new Error('wordpress: appPassword is required in channels.wordpress');

  return {
    accountId: accountId ?? null,
    siteUrl,
    username,
    appPassword,
    pollInterval: (section?.['pollInterval'] as number) ?? 2000,
    allowFrom: (section?.['allowFrom'] as string[]) ?? [],
    dmPolicy: section?.['dmPolicy'] as string | undefined,
  };
}

// ── Outbound messaging ──────────────────────────────────────────────────

/** Cache WPClient instances by siteUrl so we don't recreate on every send. */
const clientCache = new Map<string, WPClient>();

function getClient(account: WordPressAccount): WPClient {
  const key = account.siteUrl;
  let client = clientCache.get(key);
  if (!client) {
    client = new WPClient({
      siteUrl: account.siteUrl,
      username: account.username,
      appPassword: account.appPassword,
    });
    clientCache.set(key, client);
  }
  return client;
}

/**
 * Send a text message to a WordPress post thread.
 *
 * The ctx parameter matches ChannelOutboundContext from the SDK:
 *   { cfg, to, text, accountId?, ... }
 *
 * Returns Omit<OutboundDeliveryResult, 'channel'> = { messageId: string, ... }
 */
async function sendText(ctx: {
  cfg: any;
  to: string;
  text: string;
  accountId?: string | null;
}): Promise<{ messageId: string }> {
  // `ctx.to` is the post ID (as a string) — the "thread" in WordPress terms
  const postId = parseInt(ctx.to, 10);
  if (isNaN(postId)) {
    throw new Error(`wordpress: invalid post ID "${ctx.to}"`);
  }

  // Resolve the account from the config to get the WP client.
  const account = resolveAccount(ctx.cfg, ctx.accountId);
  const client = getClient(account);
  const messages = await client.getChatMessages(postId);

  const agentMessage: ChatMessage = {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    author: account.username,
    content: ctx.text,
    timestamp: new Date().toISOString(),
    type: 'message',
  };

  messages.push(agentMessage);
  await client.setChatMessages(postId, messages);

  return { messageId: agentMessage.id };
}

// ── Plugin assembly ─────────────────────────────────────────────────────

export const wordpressPlugin = createChatChannelPlugin<WordPressAccount>({
  id: 'wordpress',
  label: 'WordPress',
  blurb: 'Connect OpenClaw to WordPress 7.0 collaborative editing.',
  
  capabilities: {
    chatTypes: ['direct'],
  },

  setup: {
    resolveAccount,
    listAccountIds: (cfg) => {
      const section = getSection(cfg);
      return section ? ['default'] : [];
    },
    inspectAccount: (cfg, accountId) => {
      const section = getSection(cfg);
      const hasCreds = Boolean(section?.['siteUrl'] && section?.['username'] && section?.['appPassword']);
      return {
        enabled: hasCreds,
        configured: hasCreds,
        siteUrl: section?.['siteUrl'] ?? null,
        username: section?.['username'] ?? null,
        tokenStatus: hasCreds ? 'available' : 'missing',
      } as any;
    },
  },

  security: {
    dm: {
      channelKey: 'wordpress',
      resolvePolicy: (account) => account.dmPolicy ?? null,
      resolveAllowFrom: (account) => account.allowFrom,
      defaultPolicy: 'allowlist',
    },
  },

  pairing: {
    text: {
      idLabel: 'WordPress username',
      message: 'Send this code in the Claw Agent sidebar to verify:',
      notify: async ({ cfg, id, message }) => {
        // For MVP, pairing isn't really needed since the agent
        // authenticates via app password. Log for debugging.
        console.log(`[wordpress] Pairing notification for ${id}: ${message}`);
      },
    },
  },

  threading: { topLevelReplyToMode: 'reply' } as any,

  outbound: {
    base: {
      deliveryMode: 'direct',
    },
    attachedResults: {
      channel: 'wordpress',
      sendText,
    },
  },
});
