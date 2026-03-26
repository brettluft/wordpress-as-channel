/**
 * OpenClaw Skill: Read Post Content
 *
 * Reads a WordPress post's block content via the REST API and returns it
 * as a structured array of blocks with their type and text content.
 */

import { parseBlocks, stripHtml, wpFetch, type Block, type WPCredentials } from './utils.js';

/** Input parameters for the read-content skill. */
export interface ReadContentInput {
  /** The numeric WordPress post ID. */
  postId: number;
  /** The WordPress site URL (e.g. "https://example.com"). */
  siteUrl: string;
  /** Credentials for authenticating with the WordPress REST API. */
  credentials: WPCredentials;
}

/** A single block in the structured output. */
export interface ReadContentBlock {
  /** Zero-based index of the block within the post. */
  index: number;
  /** Block type (e.g. "paragraph", "heading", "image"). */
  type: string;
  /** The raw HTML content of the block. */
  rawContent: string;
  /** Plain-text content with HTML tags stripped. */
  textContent: string;
  /** Block attributes from the block comment delimiter. */
  attributes: Record<string, unknown>;
}

/** Output returned by the read-content skill. */
export interface ReadContentOutput {
  /** The post ID that was read. */
  postId: number;
  /** The post title (plain text). */
  title: string;
  /** The post slug. */
  slug: string;
  /** The post status (e.g. "publish", "draft"). */
  status: string;
  /** An ordered array of parsed blocks with structured content. */
  blocks: ReadContentBlock[];
}

/** Shape of the relevant fields from the WP REST API posts endpoint. */
interface WPPostResponse {
  id: number;
  title: { raw?: string; rendered: string };
  slug: string;
  status: string;
  content: { raw?: string; rendered: string };
}

/**
 * Read a WordPress post and return its block content in a structured format.
 *
 * Fetches the post via `GET /wp-json/wp/v2/posts/{id}?context=edit` so that
 * raw block markup is available, then parses each block into its type,
 * raw HTML, and stripped plain-text content.
 *
 * @param input - The post ID, site URL, and credentials.
 * @returns A structured representation of the post and its blocks.
 * @throws {Error} If the REST API request fails.
 *
 * @example
 * ```ts
 * const result = await readContent({
 *   postId: 42,
 *   siteUrl: 'https://my-site.com',
 *   credentials: { username: 'editor', applicationPassword: 'xxxx xxxx xxxx' },
 * });
 * console.log(result.blocks[0].textContent);
 * ```
 */
export async function readContent(input: ReadContentInput): Promise<ReadContentOutput> {
  const { postId, siteUrl, credentials } = input;

  const url = `${siteUrl.replace(/\/+$/, '')}/wp-json/wp/v2/posts/${postId}?context=edit`;

  const post = await wpFetch<WPPostResponse>(url, { method: 'GET' }, credentials);

  // Prefer raw content (available with context=edit); fall back to rendered.
  const rawContent = post.content.raw ?? post.content.rendered;
  const parsedBlocks: Block[] = parseBlocks(rawContent);

  const blocks: ReadContentBlock[] = parsedBlocks.map((block, index) => ({
    index,
    type: block.type,
    rawContent: block.content,
    textContent: stripHtml(block.content),
    attributes: block.attributes,
  }));

  return {
    postId: post.id,
    title: post.title.raw ?? stripHtml(post.title.rendered),
    slug: post.slug,
    status: post.status,
    blocks,
  };
}
