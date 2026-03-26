/**
 * OpenClaw Agent Skills — WordPress Content Skills Registry
 *
 * This module exports all available agent skills and a convenience registry
 * that maps skill names to their handler functions. Each skill is a
 * self-contained, natural-language-driven API integration that gives the
 * Claw Agent a specific WordPress content capability.
 *
 * @packageDocumentation
 */

// Re-export individual skill functions and their types
export { readContent } from './wp-read-content.js';
export type { ReadContentInput, ReadContentOutput, ReadContentBlock } from './wp-read-content.js';

export { suggestEdit } from './wp-suggest-edit.js';
export type { SuggestEditInput, SuggestEditOutput, Suggestion } from './wp-suggest-edit.js';

export { searchPosts } from './wp-search-posts.js';
export type { SearchPostsInput, SearchPostsOutput, SearchResult } from './wp-search-posts.js';

export { insertLink } from './wp-insert-link.js';
export type { InsertLinkInput, InsertLinkOutput } from './wp-insert-link.js';

// Re-export shared utilities and types
export {
  parseBlocks,
  serializeBlocks,
  stripHtml,
  generateId,
  wpFetch,
} from './utils.js';
export type { Block, WPCredentials, WPFetchOptions } from './utils.js';

// ---------------------------------------------------------------------------
// Skills registry — allows looking up skills by name at runtime.
// ---------------------------------------------------------------------------

import { readContent } from './wp-read-content.js';
import { suggestEdit } from './wp-suggest-edit.js';
import { searchPosts } from './wp-search-posts.js';
import { insertLink } from './wp-insert-link.js';

/** Metadata describing a single agent skill. */
export interface SkillDescriptor {
  /** A unique machine-readable identifier for the skill. */
  name: string;
  /** A short human-readable description of what the skill does. */
  description: string;
  /**
   * The skill handler function.
   *
   * Each handler accepts a single typed input object and returns a Promise
   * of a typed output object. The generic signature here uses `unknown` so
   * the registry can hold heterogeneous skills; callers should cast to the
   * concrete input/output types documented on each skill.
   */
  handler: (input: unknown) => Promise<unknown>;
}

/**
 * The complete set of OpenClaw WordPress agent skills.
 *
 * Use this array to iterate over available skills, build tool-use manifests
 * for language models, or register skills with an agent runtime.
 */
export const skills: SkillDescriptor[] = [
  {
    name: 'wp-read-content',
    description:
      'Read a WordPress post and return its block content as a structured array ' +
      'of block types and text content.',
    handler: readContent as (input: unknown) => Promise<unknown>,
  },
  {
    name: 'wp-suggest-edit',
    description:
      'Propose a content change to a specific block in a WordPress post. ' +
      'The suggestion is stored in post meta and a chat message notifies the author.',
    handler: suggestEdit as (input: unknown) => Promise<unknown>,
  },
  {
    name: 'wp-search-posts',
    description:
      'Search for WordPress posts matching a text query. Returns titles, URLs, ' +
      'and plain-text excerpts for related content discovery and internal linking.',
    handler: searchPosts as (input: unknown) => Promise<unknown>,
  },
  {
    name: 'wp-insert-link',
    description:
      'Insert an internal link into a WordPress post by wrapping specified anchor ' +
      'text in a given block with an <a> tag, then saving the updated content.',
    handler: insertLink as (input: unknown) => Promise<unknown>,
  },
];

/**
 * Look up a skill by its name.
 *
 * @param name - The skill name (e.g. "wp-read-content").
 * @returns The matching {@link SkillDescriptor}, or `undefined` if not found.
 */
export function getSkill(name: string): SkillDescriptor | undefined {
  return skills.find((s) => s.name === name);
}
