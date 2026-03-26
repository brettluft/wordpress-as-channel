/**
 * Lightweight setup entry point — loaded when the channel is disabled
 * or unconfigured, avoiding heavyweight dependencies (Yjs, WPClient).
 */

import { defineSetupPluginEntry } from './openclaw-sdk.js';
import { wordpressPlugin } from './plugin.js';

export default defineSetupPluginEntry(wordpressPlugin);
