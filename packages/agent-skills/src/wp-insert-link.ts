/**
 * OpenClaw Skill: Insert Internal Link
 *
 * Inserts an internal link into a WordPress post by wrapping the specified
 * anchor text within a given block in an `<a>` tag, then updating the post
 * content via the REST API.
 */

import {
  parseBlocks,
  serializeBlocks,
  wpFetch,
  type Block,
  type WPCredentials,
} from './utils.js';

/** Input parameters for the insert-link skill. */
export interface InsertLinkInput {
  /** The numeric WordPress post ID. */
  postId: number;
  /** The text within the block to turn into a link. Must match exactly. */
  anchorText: string;
  /** The target URL to link to (should be an internal post URL). */
  targetUrl: string;
  /** Zero-based index of the block containing the anchor text. */
  blockIndex: number;
  /** The WordPress site URL (e.g. "https://example.com"). */
  siteUrl: string;
  /** Credentials for authenticating with the WordPress REST API. */
  credentials: WPCredentials;
}

/** Output returned by the insert-link skill. */
export interface InsertLinkOutput {
  /** Whether the link was successfully inserted. */
  success: boolean;
  /** A human-readable message describing the result. */
  message: string;
  /** The modified block content after inserting the link (or null on failure). */
  modifiedBlockContent: string | null;
}

/** Shape of the WP REST API post response (relevant fields). */
interface WPPostResponse {
  id: number;
  content: { raw?: string; rendered: string };
}

/**
 * Insert an internal link into a specific block of a WordPress post.
 *
 * The skill:
 * 1. Fetches the current post content via the REST API.
 * 2. Parses the content into blocks.
 * 3. Locates the anchor text in the target block.
 * 4. Wraps the first occurrence of the anchor text in an `<a>` tag.
 * 5. Serializes the blocks back into WordPress markup.
 * 6. Updates the post via the REST API.
 *
 * If the anchor text is already linked (wrapped in an `<a>` tag), the
 * operation is skipped and a message is returned.
 *
 * @param input - The post ID, anchor text, target URL, block index, site URL, and credentials.
 * @returns Success status, a message, and the modified block content.
 * @throws {Error} If the REST API requests fail.
 *
 * @example
 * ```ts
 * const result = await insertLink({
 *   postId: 42,
 *   anchorText: 'renewable energy',
 *   targetUrl: 'https://my-site.com/renewable-energy-guide/',
 *   blockIndex: 3,
 *   siteUrl: 'https://my-site.com',
 *   credentials: { username: 'editor', applicationPassword: 'xxxx xxxx xxxx' },
 * });
 * console.log(result.message);
 * ```
 */
export async function insertLink(input: InsertLinkInput): Promise<InsertLinkOutput> {
  const { postId, anchorText, targetUrl, blockIndex, siteUrl, credentials } = input;
  const baseUrl = siteUrl.replace(/\/+$/, '');

  // 1. Fetch the current post content
  const post = await wpFetch<WPPostResponse>(
    `${baseUrl}/wp-json/wp/v2/posts/${postId}?context=edit`,
    { method: 'GET' },
    credentials,
  );

  const rawContent = post.content.raw ?? post.content.rendered;

  // 2. Parse into blocks
  const blocks: Block[] = parseBlocks(rawContent);

  // 3. Validate block index
  if (blockIndex < 0 || blockIndex >= blocks.length) {
    return {
      success: false,
      message:
        `Block index ${blockIndex} is out of range. ` +
        `The post has ${blocks.length} block(s) (indices 0-${blocks.length - 1}).`,
      modifiedBlockContent: null,
    };
  }

  const targetBlock = blocks[blockIndex]!;

  // 4. Check that the anchor text exists in the block
  if (!targetBlock.content.includes(anchorText)) {
    return {
      success: false,
      message:
        `The anchor text "${anchorText}" was not found in block #${blockIndex} ` +
        `(type: ${targetBlock.type}).`,
      modifiedBlockContent: null,
    };
  }

  // 5. Check if the anchor text is already linked
  //    Look for the pattern: <a ...>...anchorText...</a> surrounding the text
  const linkedPattern = new RegExp(
    `<a\\s[^>]*>[^<]*${escapeRegex(anchorText)}[^<]*<\\/a>`,
  );
  if (linkedPattern.test(targetBlock.content)) {
    return {
      success: false,
      message:
        `The anchor text "${anchorText}" is already wrapped in a link ` +
        `in block #${blockIndex}. No changes were made.`,
      modifiedBlockContent: null,
    };
  }

  // 6. Insert the link by replacing the first occurrence of the anchor text
  const linkHtml = `<a href="${escapeHtmlAttr(targetUrl)}">${anchorText}</a>`;
  const modifiedContent = targetBlock.content.replace(anchorText, linkHtml);
  targetBlock.content = modifiedContent;

  // 7. Serialize blocks back into WordPress markup
  const updatedRawContent = serializeBlocks(blocks);

  // 8. Update the post via REST API
  await wpFetch(
    `${baseUrl}/wp-json/wp/v2/posts/${postId}`,
    {
      method: 'POST',
      body: { content: updatedRawContent },
    },
    credentials,
  );

  return {
    success: true,
    message:
      `Successfully linked "${anchorText}" to ${targetUrl} ` +
      `in block #${blockIndex} of post ${postId}.`,
    modifiedBlockContent: modifiedContent,
  };
}

/**
 * Escape special regex characters in a string so it can be used as a
 * literal match inside a RegExp constructor.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escape a string for safe use inside an HTML attribute value
 * (double-quoted context).
 */
function escapeHtmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
