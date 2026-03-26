/**
 * Local stubs for the OpenClaw plugin SDK.
 *
 * Replace these imports with 'openclaw/plugin-sdk/core' once the SDK
 * is published to npm. These stubs replicate the builder pattern the
 * Gateway expects so the plugin compiles and runs standalone.
 */

// ── Types ───────────────────────────────────────────────────────────────

/** Gateway configuration object passed to resolveAccount / inspectAccount. */
export type OpenClawConfig = {
  channels?: Record<string, unknown>;
  [key: string]: unknown;
};

/** The resolved account returned by resolveAccount. */
export interface ResolvedAccount {
  accountId: string | null;
  [key: string]: unknown;
}

/** Result of inspectAccount (read-only status check). */
export interface InspectAccountResult {
  enabled: boolean;
  configured: boolean;
  [key: string]: unknown;
}

/** Outbound send result. */
export interface SendResult {
  messageId?: string;
  [key: string]: unknown;
}

/** Parameters for outbound text sending. */
export interface SendTextParams {
  to: string;
  text: string;
  threadTs?: string;
  replyTo?: string;
  [key: string]: unknown;
}

/** Parameters for outbound media sending. */
export interface SendMediaParams {
  to: string;
  filePath: string;
  [key: string]: unknown;
}

// ── Plugin API (passed to registerFull) ─────────────────────────────────

export interface OpenClawPluginApi {
  registrationMode: 'full' | 'setup';
  registerChannel?(plugin: unknown): void;
  registerCli?(descriptor: unknown, opts?: unknown): void;
  registerHttpRoute?(route: unknown): void;
  [key: string]: unknown;
}

// ── Builder inputs ──────────────────────────────────────────────────────

export interface ChannelPluginBaseOptions<TAccount extends ResolvedAccount> {
  id: string;
  setup: {
    resolveAccount(cfg: OpenClawConfig, accountId?: string | null): TAccount;
    inspectAccount?(cfg: OpenClawConfig, accountId?: string | null): InspectAccountResult;
  };
}

export interface ChatChannelPluginOptions<TAccount extends ResolvedAccount> {
  base: ChatChannelPluginBase<TAccount>;

  security?: {
    dm?: {
      channelKey: string;
      resolvePolicy?: (account: TAccount) => string | undefined;
      resolveAllowFrom?: (account: TAccount) => string[];
      defaultPolicy?: string;
    };
  };

  pairing?: {
    text?: {
      idLabel?: string;
      message?: string;
      notify?: (params: { target: string; code: string }) => Promise<void>;
    };
  };

  threading?: {
    topLevelReplyToMode?: 'reply' | 'new' | 'quote';
  };

  outbound?: {
    attachedResults?: {
      sendText?: (params: SendTextParams) => Promise<SendResult>;
    };
    base?: {
      sendMedia?: (params: SendMediaParams) => Promise<void>;
    };
  };
}

// ── Built objects ───────────────────────────────────────────────────────

export interface ChatChannelPluginBase<TAccount extends ResolvedAccount> {
  id: string;
  setup: ChannelPluginBaseOptions<TAccount>['setup'];
}

export interface ChatChannelPlugin<TAccount extends ResolvedAccount> {
  id: string;
  setup: ChannelPluginBaseOptions<TAccount>['setup'];
  security: ChatChannelPluginOptions<TAccount>['security'];
  pairing: ChatChannelPluginOptions<TAccount>['pairing'];
  threading: ChatChannelPluginOptions<TAccount>['threading'];
  outbound: ChatChannelPluginOptions<TAccount>['outbound'];
  /** Internal marker for the Gateway to identify this as a channel plugin. */
  __kind: 'chat-channel';
}

export interface ChannelPluginEntry<TAccount extends ResolvedAccount> {
  id: string;
  name: string;
  description: string;
  plugin: ChatChannelPlugin<TAccount>;
  registerFull?: (api: OpenClawPluginApi) => void;
}

// ── Builders ────────────────────────────────────────────────────────────

/**
 * Create the base object for a channel plugin.
 * Matches `createChannelPluginBase` from 'openclaw/plugin-sdk/core'.
 */
export function createChannelPluginBase<TAccount extends ResolvedAccount>(
  opts: ChannelPluginBaseOptions<TAccount>,
): ChatChannelPluginBase<TAccount> {
  return {
    id: opts.id,
    setup: opts.setup,
  };
}

/**
 * Assemble a complete chat channel plugin.
 * Matches `createChatChannelPlugin` from 'openclaw/plugin-sdk/core'.
 */
export function createChatChannelPlugin<TAccount extends ResolvedAccount>(
  opts: ChatChannelPluginOptions<TAccount>,
): ChatChannelPlugin<TAccount> {
  return {
    id: opts.base.id,
    setup: opts.base.setup,
    security: opts.security,
    pairing: opts.pairing,
    threading: opts.threading,
    outbound: opts.outbound,
    __kind: 'chat-channel',
  };
}

/**
 * Define the full entry point for a channel plugin.
 * Matches `defineChannelPluginEntry` from 'openclaw/plugin-sdk/core'.
 *
 * The Gateway looks for a `register` or `activate` function on the
 * default export. This wrapper adds both so the Gateway can call
 * either one to initialize the plugin.
 */
export function defineChannelPluginEntry<TAccount extends ResolvedAccount>(
  entry: ChannelPluginEntry<TAccount>,
): ChannelPluginEntry<TAccount> & {
  register: (api: OpenClawPluginApi) => void;
  activate: (api: OpenClawPluginApi) => void;
} {
  const register = (api: OpenClawPluginApi) => {
    // Register the channel plugin with the Gateway.
    // The Gateway looks for registerChannel on the api object.
    if (typeof api.registerChannel === 'function') {
      api.registerChannel(entry.plugin);
    }

    // Call the user's registerFull if provided
    if (entry.registerFull && api.registrationMode === 'full') {
      entry.registerFull(api);
    }
  };

  return {
    ...entry,
    register,
    activate: register,
  };
}

/**
 * Define a lightweight setup-only entry point.
 * Matches `defineSetupPluginEntry` from 'openclaw/plugin-sdk/core'.
 */
export function defineSetupPluginEntry<TAccount extends ResolvedAccount>(
  plugin: ChatChannelPlugin<TAccount>,
): { plugin: ChatChannelPlugin<TAccount> } {
  return { plugin };
}
