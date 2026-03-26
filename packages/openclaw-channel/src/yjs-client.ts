/**
 * Headless Yjs client for WordPress 7.0 collaborative editing.
 *
 * WordPress 7.0 stores collaborative editing state in wp_sync_storage and
 * exposes it through REST endpoints. This client maintains a local Y.Doc for
 * each post, syncs it via HTTP polling, and provides methods to read and
 * modify block content.
 */

import * as Y from 'yjs';
import {
  encodeStateAsUpdate,
  applyUpdate,
  encodeStateVector,
} from 'yjs';
import type { WPClient } from './wp-client.js';

/** Represents a single active Yjs session for one post. */
interface Session {
  postId: number;
  doc: Y.Doc;
  pollTimer: ReturnType<typeof setInterval> | null;
  changeListeners: Set<(event: YjsChangeEvent) => void>;
  lastStateVector: Uint8Array | null;
}

export interface YjsChangeEvent {
  postId: number;
  /** Which top-level Yjs shared types changed (e.g. 'blocks', 'metadata'). */
  changedKeys: string[];
}

export interface BlockContent {
  blockId: string;
  blockName: string;
  content: string;
  attributes: Record<string, unknown>;
}

const META_KEY_YJS_STATE = '_claw_yjs_state';

export class YjsClient {
  private sessions = new Map<number, Session>();

  constructor(
    private readonly wpClient: WPClient,
    private readonly pollIntervalMs: number = 3000,
  ) {}

  // ------------------------------------------------------------ public API

  /**
   * Join a post's collaborative editing session.
   * Creates a local Y.Doc, pulls the initial state from WordPress,
   * and starts polling for remote changes.
   */
  async joinSession(postId: number): Promise<void> {
    if (this.sessions.has(postId)) {
      return; // already joined
    }

    const doc = new Y.Doc();
    const session: Session = {
      postId,
      doc,
      pollTimer: null,
      changeListeners: new Set(),
      lastStateVector: null,
    };
    this.sessions.set(postId, session);

    // Pull initial state
    await this.pullRemoteState(session);

    // Start polling
    session.pollTimer = setInterval(() => {
      this.pullRemoteState(session).catch((err) => {
        console.error(
          `[YjsClient] poll error for post ${postId}:`,
          err instanceof Error ? err.message : err,
        );
      });
    }, this.pollIntervalMs);
  }

  /** Leave a post's editing session and clean up resources. */
  async leaveSession(postId: number): Promise<void> {
    const session = this.sessions.get(postId);
    if (!session) return;

    if (session.pollTimer) {
      clearInterval(session.pollTimer);
      session.pollTimer = null;
    }

    session.doc.destroy();
    session.changeListeners.clear();
    this.sessions.delete(postId);
  }

  /** Read the current document content as a list of blocks. */
  getContent(postId: number): BlockContent[] {
    const session = this.getSession(postId);
    const blocks = session.doc.getArray<Y.Map<unknown>>('blocks');
    const result: BlockContent[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks.get(i);
      if (block instanceof Y.Map) {
        result.push({
          blockId: (block.get('blockId') as string) ?? `block-${i}`,
          blockName: (block.get('blockName') as string) ?? 'core/paragraph',
          content: (block.get('content') as string) ?? '',
          attributes:
            (block.get('attributes') as Record<string, unknown>) ?? {},
        });
      }
    }
    return result;
  }

  /** Register a callback for document changes on a specific post. */
  observeChanges(
    postId: number,
    callback: (event: YjsChangeEvent) => void,
  ): () => void {
    const session = this.getSession(postId);
    session.changeListeners.add(callback);

    // Also listen to the Y.Doc's update event
    const handler = (_update: Uint8Array, _origin: unknown) => {
      callback({ postId, changedKeys: ['blocks'] });
    };
    session.doc.on('update', handler);

    return () => {
      session.changeListeners.delete(callback);
      session.doc.off('update', handler);
    };
  }

  /**
   * Modify a block's content by its blockId.
   * Applies the change locally and pushes to WordPress.
   */
  async applyEdit(
    postId: number,
    blockId: string,
    newContent: string,
  ): Promise<boolean> {
    const session = this.getSession(postId);
    const blocks = session.doc.getArray<Y.Map<unknown>>('blocks');

    let found = false;

    session.doc.transact(() => {
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks.get(i);
        if (block instanceof Y.Map && block.get('blockId') === blockId) {
          block.set('content', newContent);
          found = true;
          break;
        }
      }
    });

    if (!found) {
      return false;
    }

    // Push the updated state to WordPress
    await this.pushLocalState(session);
    return true;
  }

  /** Get the Y.Doc for a session (for advanced use). */
  getDoc(postId: number): Y.Doc {
    return this.getSession(postId).doc;
  }

  /** Leave all active sessions and clean up. */
  async destroy(): Promise<void> {
    const postIds = [...this.sessions.keys()];
    await Promise.all(postIds.map((id) => this.leaveSession(id)));
  }

  // ----------------------------------------------------------- internal

  private getSession(postId: number): Session {
    const session = this.sessions.get(postId);
    if (!session) {
      throw new Error(
        `No active session for post ${postId}. Call joinSession() first.`,
      );
    }
    return session;
  }

  /**
   * Pull the remote Yjs state from WordPress and merge it into
   * the local document.
   */
  private async pullRemoteState(session: Session): Promise<void> {
    const remoteB64 = await this.wpClient.getPostMeta<string>(
      session.postId,
      META_KEY_YJS_STATE,
    );

    if (!remoteB64) {
      // No remote state yet -- initialise from post content
      await this.initDocFromPostContent(session);
      return;
    }

    const remoteUpdate = base64ToUint8Array(remoteB64);

    // Compute what changed
    const beforeSV = encodeStateVector(session.doc);

    applyUpdate(session.doc, remoteUpdate);

    const afterSV = encodeStateVector(session.doc);

    // If the state vector changed, notify listeners
    if (!uint8ArraysEqual(beforeSV, afterSV)) {
      for (const listener of session.changeListeners) {
        try {
          listener({ postId: session.postId, changedKeys: ['blocks'] });
        } catch (err) {
          console.error('[YjsClient] change listener error:', err);
        }
      }
    }

    session.lastStateVector = afterSV;
  }

  /** Push the local Y.Doc state to WordPress. */
  private async pushLocalState(session: Session): Promise<void> {
    const update = encodeStateAsUpdate(session.doc);
    const b64 = uint8ArrayToBase64(update);
    await this.wpClient.updatePostMeta(
      session.postId,
      META_KEY_YJS_STATE,
      b64,
    );
    session.lastStateVector = encodeStateVector(session.doc);
  }

  /**
   * When there is no Yjs state stored yet, bootstrap the Y.Doc from
   * the post's HTML content. This creates one block per paragraph.
   */
  private async initDocFromPostContent(session: Session): Promise<void> {
    const post = await this.wpClient.getPost(session.postId);
    const html = post.content.rendered;
    const blocks = session.doc.getArray<Y.Map<unknown>>('blocks');

    if (blocks.length > 0) {
      return; // already has content
    }

    session.doc.transact(() => {
      // Split HTML into rough block boundaries. WordPress block markup uses
      // <!-- wp:blockname --> comments, but the rendered field strips those.
      // We split on double newlines / <p> tags as a simple heuristic.
      const segments = html
        .split(/<\/?p[^>]*>/i)
        .map((s) => s.trim())
        .filter(Boolean);

      segments.forEach((segment, index) => {
        const block = new Y.Map<unknown>();
        block.set('blockId', `block-${session.postId}-${index}`);
        block.set('blockName', 'core/paragraph');
        block.set('content', segment);
        block.set('attributes', {});
        blocks.push([block]);
      });
    });

    // Persist initial state
    await this.pushLocalState(session);
  }
}

// ------------------------------------------------------------------ util

function uint8ArrayToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function base64ToUint8Array(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function uint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
