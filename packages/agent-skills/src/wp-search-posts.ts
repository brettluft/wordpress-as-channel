/**
 * OpenClaw Skill: Search Posts
 *
 * Searches for WordPress posts matching a text query via the REST API.
 * Useful for finding related content, suggesting internal links, or
 * locating posts by topic.
 */

import { stripHtml, wpFetch, type WPCredentials } from './utils.js';

/** Input parameters for the search-posts skill. */
export interface SearchPostsInput {
  /** The search query string. */
  query: string;
  /** The WordPress site URL (e.g. "https://example.com"). */
  siteUrl: string;
  /** Credentials for authenticating with the WordPress REST API. */
  credentials: WPCredentials;
  /** Maximum number of results to return. Defaults to 5. */
  perPage?: number;
}

/** A single search result. */
export interface SearchResult {
  /** The WordPress post ID. */
  id: number;
  /** The post title (plain text). */
  title: string;
  /** The permalink URL of the post. */
  url: string;
  /** A plain-text excerpt of the post content. */
  excerpt: string;
}

/** Output returned by the search-posts skill. */
export interface SearchPostsOutput {
  /** The original search query. */
  query: string;
  /** The number of results found. */
  resultCount: number;
  /** The matching posts. */
  results: SearchResult[];
}

/**
 * Shape of a single item from the WP REST API search endpoint.
 * The search endpoint returns a slimmer representation than the posts endpoint.
 */
interface WPSearchItem {
  id: number;
  title: string;
  url: string;
  type: string;
  subtype: string;
}

/** Shape of a single post from the WP REST API posts endpoint. */
interface WPPostItem {
  id: number;
  excerpt: { rendered: string };
}

/**
 * Search for WordPress posts matching a text query.
 *
 * Uses the WordPress search endpoint (`/wp-json/wp/v2/search`) to find
 * posts by keyword, then fetches their excerpts from the posts endpoint.
 * HTML tags are stripped from excerpts to provide clean plain-text output.
 *
 * @param input - The search query, site URL, credentials, and optional result limit.
 * @returns An array of matching posts with their ID, title, URL, and excerpt.
 * @throws {Error} If the REST API requests fail.
 *
 * @example
 * ```ts
 * const results = await searchPosts({
 *   query: 'climate change',
 *   siteUrl: 'https://my-site.com',
 *   credentials: { username: 'editor', applicationPassword: 'xxxx xxxx xxxx' },
 * });
 * results.results.forEach(r => console.log(`${r.title}: ${r.url}`));
 * ```
 */
export async function searchPosts(input: SearchPostsInput): Promise<SearchPostsOutput> {
  const { query, siteUrl, credentials, perPage = 5 } = input;
  const baseUrl = siteUrl.replace(/\/+$/, '');

  // 1. Search for posts matching the query
  const encodedQuery = encodeURIComponent(query);
  const searchUrl =
    `${baseUrl}/wp-json/wp/v2/search` +
    `?search=${encodedQuery}&type=post&subtype=post&per_page=${perPage}`;

  const searchItems = await wpFetch<WPSearchItem[]>(
    searchUrl,
    { method: 'GET' },
    credentials,
  );

  if (searchItems.length === 0) {
    return { query, resultCount: 0, results: [] };
  }

  // 2. Fetch excerpts for the matching post IDs
  const postIds = searchItems.map((item) => item.id);
  const includeParam = postIds.join(',');
  const postsUrl =
    `${baseUrl}/wp-json/wp/v2/posts` +
    `?include=${includeParam}&per_page=${perPage}&_fields=id,excerpt`;

  const posts = await wpFetch<WPPostItem[]>(postsUrl, { method: 'GET' }, credentials);

  // Build a lookup map of id -> excerpt
  const excerptMap = new Map<number, string>();
  for (const post of posts) {
    excerptMap.set(post.id, stripHtml(post.excerpt.rendered));
  }

  // 3. Assemble the results in the original search order
  const results: SearchResult[] = searchItems.map((item) => ({
    id: item.id,
    title: stripHtml(item.title),
    url: item.url,
    excerpt: excerptMap.get(item.id) ?? '',
  }));

  return {
    query,
    resultCount: results.length,
    results,
  };
}
