/**
 * Local stub for the OpenClaw plugin SDK.
 *
 * The official `openclaw` package isn't published to npm yet.
 * This provides the `definePluginEntry` helper and the `PluginAPI`
 * type so the channel compiles standalone. Replace this with
 * `import { definePluginEntry } from 'openclaw/plugin-sdk'` once
 * the SDK is available on npm.
 */

import type { ChannelPlugin } from './types.js';

/** Minimal representation of the OpenClaw plugin API object. */
export interface PluginAPI {
  registerChannel(channel: ChannelPlugin): void;
  registerTool?(tool: unknown): void;
  registerHook?(name: string, handler: (...args: unknown[]) => void): void;
}

export interface PluginEntry {
  id: string;
  name: string;
  version?: string;
  register(api: PluginAPI): void;
}

/**
 * Define an OpenClaw plugin entry point.
 *
 * This is the same signature as the real SDK's `definePluginEntry`.
 * It simply returns the entry object — the Gateway calls `register(api)`
 * at startup.
 */
export function definePluginEntry(entry: PluginEntry): PluginEntry {
  return entry;
}
