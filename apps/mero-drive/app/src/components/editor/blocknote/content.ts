// Storage format layer for the BlockNote editor.
//
// Docs are persisted through the Calimero CRDT as an opaque `content`
// string (see DocsClient / useDocs.edit — the WASM never parses it).
// With BlockNote we store the editor's native lossless format:
//   content === JSON.stringify(editor.document)
// a serialized `Block[]`. This keeps the whole autosave / SSE / seq-guard
// machinery in DocumentEditor unchanged — it only ever compares opaque
// strings, which now happen to be JSON instead of HTML.
//
// This module is intentionally free of any live-editor / React / DOM
// dependency so the round-trip and text-extraction logic can be unit
// tested in isolation.

import type { Block, PartialBlock } from '@blocknote/core';

// Serialize the current document to the string we persist.
export function serializeBlocks(blocks: Block[]): string {
  return JSON.stringify(blocks);
}

// Parse a stored `content` string into blocks suitable for
// `initialContent` / `replaceBlocks`.
//
// Returns `undefined` (→ BlockNote creates a default empty document) for:
//   - empty / whitespace-only / null content (a brand-new doc), and
//   - anything that isn't a non-empty JSON array.
//
// The last case deliberately swallows legacy HTML and malformed strings:
// this is a NEW editor for a NEW app — there is no HTML history to
// migrate, so non-JSON content simply opens as a fresh empty document
// rather than throwing. Never pass `[]` to BlockNote (a document needs
// at least one block); an empty array maps to `undefined` here too.
export function parseStoredContent(
  raw: string | null | undefined,
): PartialBlock[] | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Legacy HTML or otherwise non-JSON — start fresh (nothing to migrate).
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  return parsed as PartialBlock[];
}

// ── plain-text extraction (word / character counts) ───────────────────
//
// BlockNote has no public synchronous "give me the plain text" getter,
// so we walk the block tree ourselves. Each block's `content` is either
// an array of inline nodes (text / link / mention-style), a table
// payload, or undefined (e.g. an image). Links carry their own nested
// inline `content`. Children blocks (nested list items, etc.) recurse.

interface InlineTextNode {
  type: 'text';
  text?: string;
}
interface InlineLinkNode {
  type: 'link';
  content?: unknown;
}
type InlineNode = InlineTextNode | InlineLinkNode | { type: string };

function inlineToText(content: unknown): string {
  if (!Array.isArray(content)) return ''; // table payload or no inline content
  return (content as InlineNode[])
    .map((node) => {
      if (!node || typeof node !== 'object') return '';
      if (node.type === 'text') return (node as InlineTextNode).text ?? '';
      if (node.type === 'link') {
        return inlineToText((node as InlineLinkNode).content);
      }
      return '';
    })
    .join('');
}

interface BlockLike {
  content?: unknown;
  children?: unknown;
}

export function blocksToPlainText(blocks: readonly BlockLike[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    // Skip empty blocks (images, tables, blank paragraphs) so they don't
    // inject stray newlines — e.g. a leading image must not produce a
    // leading "\n" that throws off the counted text.
    const text = inlineToText(block.content);
    if (text) parts.push(text);
    if (Array.isArray(block.children) && block.children.length > 0) {
      const childText = blocksToPlainText(block.children as BlockLike[]);
      if (childText) parts.push(childText);
    }
  }
  return parts.join('\n');
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

export function countCharacters(text: string): number {
  // Strip the inter-block newlines we inserted so the count reflects
  // visible characters, matching the previous Tiptap status bar which
  // counted `doc.textContent` (no block separators).
  return text.replace(/\n/g, '').length;
}
