/**
 * WordPress channel plugin — built with createChatChannelPlugin.
 *
 * This follows the OpenClaw channel plugin contract:
 *   resolveAccount → reads credentials from config.channels.wordpress
 *   outbound.sendText → writes agent messages to WP post meta
 *   security/pairing/threading → minimal defaults for MVP
 *
 * Inbound message polling is started via registerFull → api.registerHttpRoute
 * or can be kicked off externally.
 */

import {
  createChatChannelPlugin,
  createChannelPluginBase,
  type OpenClawConfig,
  type ResolvedAccount,
  type InspectAccountResult,
  type SendTextParams,
  type SendResult,
} from './openclaw-sdk.js';
import { WPClient } from './wp-client.js';
import type { PostChatMessages, ChatMessage } from './types.js';

// ── Account type ────────────────────────────────────────────────────────

export interface WordPressAccount extends ResolvedAccount {
  accountId: string | null;
  siteUrl: string;
  username: string;
  appPassword: string;
  pollInterval: number;
  allowFrom: string[];
  dmPolicy: string | undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function getSection(cfg: OpenClawConfig): Record<string, unknown> | undefined {
  const channels = cfg.channels as Record<string, Record<string, unknown>> | undefined;
  return channels?.['wordpress'];
}

function resolveAccount(
  cfg: OpenClawConfig,
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

function inspectAccount(
  cfg: OpenClawConfig,
  _accountId?: string | null,
): InspectAccountResult {
  const section = getSection(cfg);
  const hasCreds = Boolean(section?.['siteUrl'] && section?.['username'] && section?.['appPassword']);
  return {
    enabled: hasCreds,
    configured: hasCreds,
    siteUrl: section?.['siteUrl'] ?? null,
    username: section?.['username'] ?? null,
    tokenStatus: hasCreds ? 'available' : 'missing',
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

async function sendText(params: SendTextParams): Promise<SendResult> {
  // `params.to` is the post ID (as a string) — the "thread" in WordPress terms
  const postId = parseInt(params.to, 10);
  if (isNaN(postId)) {
    throw new Error(`wordpress: invalid post ID "${params.to}"`);
  }

  // We need the account to get the WP client. The account is stashed on
  // the params object by the Gateway as `params.__account`.
  const account = (params as Record<string, unknown>)['__account'] as WordPressAccount | undefined;
  if (!account) {
    throw new Error('wordpress: no account context in sendText params');
  }

  const client = getClient(account);
  const messages = await client.getChatMessages(postId);

  const agentMessage: ChatMessage = {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    author: account.username,
    content: params.text,
    timestamp: new Date().toISOString(),
    type: 'message',
  };

  messages.push(agentMessage);
  await client.setChatMessages(postId, messages);

  return { messageId: agentMessage.id };
}

// ── Plugin assembly ─────────────────────────────────────────────────────

export const wordpressPlugin = createChatChannelPlugin<WordPressAccount>({
  base: createChannelPluginBase<WordPressAccount>({
    id: 'wordpress',
    setup: {
      resolveAccount,
      inspectAccount,
    },
  }),

  security: {
    dm: {
      channelKey: 'wordpress',
      resolvePolicy: (account) => account.dmPolicy,
      resolveAllowFrom: (account) => account.allowFrom,
      defaultPolicy: 'allowlist',
    },
  },

  pairing: {
    text: {
      idLabel: 'WordPress username',
      message: 'Send this code in the Claw Agent sidebar to verify:',
      notify: async ({ target, code }) => {
        // For MVP, pairing isn't really needed since the agent
        // authenticates via app password. Log for debugging.
        console.log(`[wordpress] Pairing code for ${target}: ${code}`);
      },
    },
  },

  threading: { topLevelReplyToMode: 'reply' },

  outbound: {
    attachedResults: {
      sendText,
    },
  },
});
