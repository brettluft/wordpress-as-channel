/**
 * Shared utilities for OpenClaw agent skills.
 *
 * Provides block parsing/serialization, HTML stripping, ID generation,
 * and an authenticated WordPress REST API fetch wrapper.
 */

/** Credentials used to authenticate against the WordPress REST API. */
export interface WPCredentials {
  /** WordPress application password username. */
  username: string;
  /** WordPress application password. */
  applicationPassword: string;
}

/** A single parsed WordPress block. */
export interface Block {
  /** The block type identifier, e.g. "paragraph", "heading", "image". */
  type: string;
  /** The inner HTML content of the block. */
  content: string;
  /** Raw attributes parsed from the block comment delimiter (JSON object). */
  attributes: Record<string, unknown>;
}

/**
 * Parse WordPress block markup (Gutenberg) into a structured array.
 *
 * WordPress stores content as HTML interspersed with block comment delimiters:
 * ```
 * <!-- wp:paragraph -->
 * <p>Hello world</p>
 * <!-- /wp:paragraph -->
 * ```
 *
 * This function extracts each block's type, attributes, and inner content.
 * Content that falls outside any block delimiters is collected as a
 * "freeform" block.
 *
 * @param content - Raw post content string from the WordPress REST API.
 * @returns An ordered array of parsed {@link Block} objects.
 */
export function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];

  // Matches opening block comments: <!-- wp:type {"attr":"val"} -->
  // and self-closing blocks: <!-- wp:type /-->
  const blockRegex =
    /<!-- wp:([a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?)(\s+(\{.*?\}))?\s*(\/)?-->/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(content)) !== null) {
    const blockType = match[1]!;
    const attrsJson = match[3];
    const selfClosing = match[4];

    // Capture any freeform content before this block
    const prefixContent = content.slice(lastIndex, match.index).trim();
    if (prefixContent.length > 0) {
      blocks.push({ type: 'freeform', content: prefixContent, attributes: {} });
    }

    let attributes: Record<string, unknown> = {};
    if (attrsJson) {
      try {
        attributes = JSON.parse(attrsJson) as Record<string, unknown>;
      } catch {
        // If attributes aren't valid JSON, keep them empty.
      }
    }

    if (selfClosing) {
      // Self-closing block, e.g. <!-- wp:separator /-->
      blocks.push({ type: blockType, content: '', attributes });
      lastIndex = match.index + match[0].length;
    } else {
      // Find the matching closing comment
      const closingTag = `<!-- /wp:${blockType} -->`;
      const closingIndex = content.indexOf(closingTag, match.index + match[0].length);

      if (closingIndex !== -1) {
        const innerContent = content
          .slice(match.index + match[0].length, closingIndex)
          .trim();
        blocks.push({ type: blockType, content: innerContent, attributes });
        lastIndex = closingIndex + closingTag.length;
      } else {
        // No closing tag found — treat the rest as the block content.
        const innerContent = content.slice(match.index + match[0].length).trim();
        blocks.push({ type: blockType, content: innerContent, attributes });
        lastIndex = content.length;
      }
    }

    // Reset regex lastIndex to continue from our tracked position
    blockRegex.lastIndex = lastIndex;
  }

  // Capture any trailing freeform content after the last block
  const trailingContent = content.slice(lastIndex).trim();
  if (trailingContent.length > 0) {
    blocks.push({ type: 'freeform', content: trailingContent, attributes: {} });
  }

  return blocks;
}

/**
 * Serialize an array of structured blocks back into WordPress block markup.
 *
 * This is the inverse of {@link parseBlocks}. Freeform blocks are emitted
 * as raw content without comment delimiters.
 *
 * @param blocks - The array of {@link Block} objects to serialize.
 * @returns A string of WordPress block markup ready to be saved via the REST API.
 */
export function serializeBlocks(blocks: Block[]): string {
  return blocks
    .map((block) => {
      if (block.type === 'freeform') {
        return block.content;
      }

      const hasAttributes = Object.keys(block.attributes).length > 0;
      const attrsStr = hasAttributes ? ` ${JSON.stringify(block.attributes)}` : '';

      if (block.content === '') {
        // Self-closing block
        return `<!-- wp:${block.type}${attrsStr} /-->`;
      }

      return [
        `<!-- wp:${block.type}${attrsStr} -->`,
        block.content,
        `<!-- /wp:${block.type} -->`,
      ].join('\n');
    })
    .join('\n\n');
}

/**
 * Strip all HTML tags from a string, leaving only the text content.
 *
 * @param html - A string that may contain HTML markup.
 * @returns The plain-text content with all tags removed and whitespace normalised.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generate a v4 UUID string.
 *
 * Uses `crypto.randomUUID()` when available (Node 19+), otherwise falls back
 * to a standards-compliant polyfill built on `crypto.getRandomValues()`.
 *
 * @returns A randomly-generated UUID v4 string.
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback for older Node versions
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Set version (4) and variant (10xx) bits per RFC 4122
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** Options passed through to the underlying fetch call. */
export interface WPFetchOptions {
  /** HTTP method. Defaults to "GET". */
  method?: string;
  /** Request headers to merge with authentication headers. */
  headers?: Record<string, string>;
  /** JSON-serialisable request body. Automatically stringified. */
  body?: unknown;
}

/**
 * Authenticated fetch wrapper for the WordPress REST API.
 *
 * Adds Basic authentication (application-password style) and appropriate
 * content-type headers. Throws on non-2xx responses with the status text
 * and response body included in the error message.
 *
 * @param url - The full REST API URL to request.
 * @param options - Fetch options (method, headers, body).
 * @param credentials - WordPress application password credentials.
 * @returns The parsed JSON response body.
 * @throws {Error} If the response status is not in the 2xx range.
 */
export async function wpFetch<T = unknown>(
  url: string,
  options: WPFetchOptions,
  credentials: WPCredentials,
): Promise<T> {
  const authToken = Buffer.from(
    `${credentials.username}:${credentials.applicationPassword}`,
  ).toString('base64');

  const headers: Record<string, string> = {
    Authorization: `Basic ${authToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...options.headers,
  };

  const fetchOptions: RequestInit = {
    method: options.method ?? 'GET',
    headers,
  };

  if (options.body !== undefined) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `WordPress REST API error (${response.status} ${response.statusText}): ${errorBody}`,
    );
  }

  return (await response.json()) as T;
}
