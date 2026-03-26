/**
 * Typed client for the WordPress REST API.
 *
 * Authenticates via Basic Auth using the agent's application password
 * and provides methods for all endpoints the channel needs.
 */

import type {
  AgentConfig,
  WordPressPost,
  PostChatMessages,
} from './types.js';

export interface WPClientConfig {
  siteUrl: string;
  username: string;
  appPassword: string;
}

export class WPClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(private readonly config: WPClientConfig) {
    // Normalise: strip trailing slash
    this.baseUrl = config.siteUrl.replace(/\/+$/, '');
    const credentials = Buffer.from(
      `${config.username}:${config.appPassword}`,
    ).toString('base64');
    this.authHeader = `Basic ${credentials}`;
  }

  // ------------------------------------------------------------------ helpers

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new WPClientError(
        `WordPress API ${options.method ?? 'GET'} ${path} returned ${response.status}: ${body}`,
        response.status,
        path,
      );
    }

    return response.json() as Promise<T>;
  }

  // --------------------------------------------------------------- endpoints

  /** GET /wp-json/claw-agent/v1/config -- agent plugin configuration. */
  async getConfig(): Promise<AgentConfig> {
    return this.request<AgentConfig>('/wp-json/claw-agent/v1/config');
  }

  /**
   * GET /wp-json/wp/v2/posts -- list posts, optionally filtered by
   * modification date so we only fetch posts that changed since last poll.
   */
  async getPosts(modifiedAfter?: string): Promise<WordPressPost[]> {
    const params = new URLSearchParams({
      per_page: '50',
      orderby: 'modified',
      order: 'desc',
      context: 'edit',
      _fields: 'id,title,content,status,modified,modified_gmt,meta',
    });

    if (modifiedAfter) {
      params.set('modified_after', modifiedAfter);
    }

    return this.request<WordPressPost[]>(
      `/wp-json/wp/v2/posts?${params.toString()}`,
    );
  }

  /** GET /wp-json/wp/v2/posts/{id} -- fetch a single post. */
  async getPost(postId: number): Promise<WordPressPost> {
    return this.request<WordPressPost>(
      `/wp-json/wp/v2/posts/${postId}?context=edit&_fields=id,title,content,status,modified,modified_gmt,meta`,
    );
  }

  /** Read a specific meta key from a post. */
  async getPostMeta<T = unknown>(
    postId: number,
    metaKey: string,
  ): Promise<T | null> {
    const post = await this.request<WordPressPost>(
      `/wp-json/wp/v2/posts/${postId}?context=edit&_fields=meta`,
    );
    const value = post.meta?.[metaKey];
    if (value === undefined || value === null || value === '') {
      return null;
    }
    // WordPress stores meta values as JSON strings for complex data.
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as T;
      } catch {
        return value as T;
      }
    }
    return value as T;
  }

  /** Update a meta value on a post via POST /wp-json/wp/v2/posts/{id}. */
  async updatePostMeta(
    postId: number,
    metaKey: string,
    value: unknown,
  ): Promise<void> {
    const serialised =
      typeof value === 'string' ? value : JSON.stringify(value);
    await this.request<WordPressPost>(`/wp-json/wp/v2/posts/${postId}`, {
      method: 'POST',
      body: JSON.stringify({
        meta: { [metaKey]: serialised },
      }),
    });
  }

  /** GET /wp-json/wp/v2/search -- search across posts. */
  async searchPosts(
    query: string,
  ): Promise<Array<{ id: number; title: string; url: string }>> {
    const params = new URLSearchParams({
      search: query,
      type: 'post',
      per_page: '10',
    });
    return this.request<Array<{ id: number; title: string; url: string }>>(
      `/wp-json/wp/v2/search?${params.toString()}`,
    );
  }

  /**
   * Read the chat messages meta for a given post.
   * Returns the parsed flat array of messages, or an empty array if none exist.
   */
  async getChatMessages(postId: number): Promise<PostChatMessages> {
    const result = await this.getPostMeta<PostChatMessages>(postId, '_claw_chat_messages');
    return Array.isArray(result) ? result : [];
  }

  /**
   * Write chat messages array back to the post meta.
   */
  async setChatMessages(
    postId: number,
    messages: PostChatMessages,
  ): Promise<void> {
    await this.updatePostMeta(postId, '_claw_chat_messages', messages);
  }

  /** Verify that the authenticated user has the expected capabilities. */
  async verifyAuth(): Promise<{ ok: boolean; userId: number; name: string }> {
    interface WPUser {
      id: number;
      name: string;
      capabilities: Record<string, boolean>;
    }

    const me = await this.request<WPUser>(
      '/wp-json/wp/v2/users/me?context=edit',
    );
    return { ok: true, userId: me.id, name: me.name };
  }
}

/** Custom error class that carries the HTTP status code. */
export class WPClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = 'WPClientError';
  }
}
