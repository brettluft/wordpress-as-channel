/**
 * OpenClaw Skill: Suggest an Edit
 *
 * Proposes a content change on a specific block within a WordPress post.
 * Suggestions are stored in the `_claw_suggestions` post meta field and
 * a chat message is generated to notify the author.
 */

import { generateId, wpFetch, type WPCredentials } from './utils.js';

/** A single edit suggestion stored in post meta. */
export interface Suggestion {
  /** Unique identifier for the suggestion (UUID v4). */
  id: string;
  /** Zero-based index of the block being edited. */
  blockIndex: number;
  /** The original content of the block before the suggested change. */
  originalContent: string;
  /** The suggested replacement content for the block. */
  suggestedContent: string;
  /** Current status of the suggestion. */
  status: 'pending' | 'accepted' | 'rejected';
  /** A human-readable explanation of why the edit was suggested. */
  reason: string;
  /** ISO 8601 timestamp of when the suggestion was created. */
  timestamp: string;
}

/** Input parameters for the suggest-edit skill. */
export interface SuggestEditInput {
  /** The numeric WordPress post ID. */
  postId: number;
  /** Zero-based index of the block to suggest an edit for. */
  blockIndex: number;
  /** The proposed new content for the block. */
  suggestedContent: string;
  /** A human-readable explanation of the suggested change. */
  reason: string;
  /** The WordPress site URL (e.g. "https://example.com"). */
  siteUrl: string;
  /** Credentials for authenticating with the WordPress REST API. */
  credentials: WPCredentials;
}

/** Output returned by the suggest-edit skill. */
export interface SuggestEditOutput {
  /** Whether the suggestion was successfully stored. */
  success: boolean;
  /** The unique ID assigned to the new suggestion. */
  suggestionId: string;
  /** A chat message that can be displayed to the author about this suggestion. */
  chatMessage: string;
  /** The full suggestion object as stored in post meta. */
  suggestion: Suggestion;
}

/** Shape of the WP REST API post response for meta reads. */
interface WPPostMetaResponse {
  id: number;
  content: { raw?: string; rendered: string };
  meta: Record<string, unknown>;
}

/**
 * Read the current post content and its block at the given index, then store
 * the suggestion in the `_claw_suggestions` post meta array.
 *
 * The skill:
 * 1. Fetches the post to retrieve existing suggestions and the current block content.
 * 2. Creates a new {@link Suggestion} record with a UUID, the original content,
 *    the proposed content, a reason, and a "pending" status.
 * 3. Appends the suggestion to the `_claw_suggestions` meta field via the REST API.
 * 4. Returns a chat-ready message that can be shown to the post author.
 *
 * @param input - The post ID, block index, suggested content, reason, site URL, and credentials.
 * @returns The stored suggestion and a formatted chat message.
 * @throws {Error} If the REST API requests fail or the block index is out of range.
 *
 * @example
 * ```ts
 * const result = await suggestEdit({
 *   postId: 42,
 *   blockIndex: 2,
 *   suggestedContent: '<p>Updated paragraph with clearer language.</p>',
 *   reason: 'The original wording was ambiguous and could confuse readers.',
 *   siteUrl: 'https://my-site.com',
 *   credentials: { username: 'editor', applicationPassword: 'xxxx xxxx xxxx' },
 * });
 * console.log(result.chatMessage);
 * ```
 */
export async function suggestEdit(input: SuggestEditInput): Promise<SuggestEditOutput> {
  const { postId, blockIndex, suggestedContent, reason, siteUrl, credentials } = input;
  const baseUrl = siteUrl.replace(/\/+$/, '');

  // 1. Read the current post to get existing suggestions and content
  const post = await wpFetch<WPPostMetaResponse>(
    `${baseUrl}/wp-json/wp/v2/posts/${postId}?context=edit`,
    { method: 'GET' },
    credentials,
  );

  // 2. Extract the original block content at the specified index
  const rawContent = post.content.raw ?? post.content.rendered;
  const originalBlockContent = extractBlockContent(rawContent, blockIndex);

  if (originalBlockContent === null) {
    throw new Error(
      `Block index ${blockIndex} is out of range for post ${postId}. ` +
        `The post may have fewer blocks than expected.`,
    );
  }

  // 3. Build the suggestion record
  const suggestion: Suggestion = {
    id: generateId(),
    blockIndex,
    originalContent: originalBlockContent,
    suggestedContent,
    status: 'pending',
    reason,
    timestamp: new Date().toISOString(),
  };

  // 4. Read existing suggestions from meta and append
  const existingRaw = post.meta?.['_claw_suggestions'];
  let existingSuggestions: Suggestion[] = [];

  if (typeof existingRaw === 'string' && existingRaw.length > 0) {
    try {
      existingSuggestions = JSON.parse(existingRaw) as Suggestion[];
    } catch {
      // If meta is corrupted, start fresh.
      existingSuggestions = [];
    }
  } else if (Array.isArray(existingRaw)) {
    existingSuggestions = existingRaw as Suggestion[];
  }

  const updatedSuggestions = [...existingSuggestions, suggestion];

  // 5. Write the updated suggestions back to post meta
  await wpFetch(
    `${baseUrl}/wp-json/wp/v2/posts/${postId}`,
    {
      method: 'POST',
      body: {
        meta: {
          _claw_suggestions: JSON.stringify(updatedSuggestions),
        },
      },
    },
    credentials,
  );

  // 6. Build the chat notification message
  const chatMessage = formatChatMessage(postId, blockIndex, reason, suggestion.id);

  return {
    success: true,
    suggestionId: suggestion.id,
    chatMessage,
    suggestion,
  };
}

/**
 * Extract the content of a specific block by index from raw post markup.
 *
 * Uses a simple regex-based block boundary detector. Returns `null` if the
 * block index is out of range.
 */
function extractBlockContent(rawContent: string, blockIndex: number): string | null {
  const blockRegex =
    /<!-- wp:([a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?)(\s+\{.*?\})?\s*(\/)?-->/g;

  interface BlockSpan {
    content: string;
  }

  const blockSpans: BlockSpan[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(rawContent)) !== null) {
    const blockType = match[1]!;
    const selfClosing = match[3];

    // Freeform content before this block
    const prefix = rawContent.slice(lastIndex, match.index).trim();
    if (prefix.length > 0) {
      blockSpans.push({ content: prefix });
    }

    if (selfClosing) {
      blockSpans.push({ content: '' });
      lastIndex = match.index + match[0].length;
    } else {
      const closingTag = `<!-- /wp:${blockType} -->`;
      const closingIndex = rawContent.indexOf(closingTag, match.index + match[0].length);
      if (closingIndex !== -1) {
        const inner = rawContent.slice(match.index + match[0].length, closingIndex).trim();
        blockSpans.push({ content: inner });
        lastIndex = closingIndex + closingTag.length;
      } else {
        const inner = rawContent.slice(match.index + match[0].length).trim();
        blockSpans.push({ content: inner });
        lastIndex = rawContent.length;
      }
    }

    blockRegex.lastIndex = lastIndex;
  }

  // Trailing freeform content
  const trailing = rawContent.slice(lastIndex).trim();
  if (trailing.length > 0) {
    blockSpans.push({ content: trailing });
  }

  if (blockIndex < 0 || blockIndex >= blockSpans.length) {
    return null;
  }

  return blockSpans[blockIndex]!.content;
}

/**
 * Format a human-readable chat message about the suggestion.
 */
function formatChatMessage(
  postId: number,
  blockIndex: number,
  reason: string,
  suggestionId: string,
): string {
  return (
    `I've suggested an edit to block #${blockIndex} in post ${postId}.\n\n` +
    `**Reason:** ${reason}\n\n` +
    `You can review this suggestion (ID: ${suggestionId}) in the Claw sidebar ` +
    `and choose to accept, reject, or modify it.`
  );
}
