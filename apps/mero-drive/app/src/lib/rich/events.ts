// The document events the node delivers over SSE, in the two shapes it uses:
// a StateMutation batch whose payloads are JSON bytes, and a single tagged
// variant. Every field is checked, so a stray payload is dropped, not guessed.

import type { Run } from './echo';

export type RichEvent =
  | { kind: 'TitleChanged'; doc: string; ids: Run[] }
  | { kind: 'TextChanged'; doc: string; block: string; ids: Run[] }
  | {
      kind: 'BlockInserted' | 'BlockDeleted' | 'BlockMoved' | 'BlockChanged';
      doc: string;
      block: string;
    }
  | { kind: 'MarkApplied'; doc: string; block: string; markId: string };

const BLOCK_KINDS = [
  'BlockInserted',
  'BlockDeleted',
  'BlockMoved',
  'BlockChanged',
] as const;

type BlockKind = (typeof BLOCK_KINDS)[number];

/** Every rich-document event in one delivered SSE payload. */
export function parseRichEvents(data: unknown): RichEvent[] {
  const payload = asRecord(data);
  if (!payload) return [];

  if (Array.isArray(payload.events)) {
    const out: RichEvent[] = [];
    for (const entry of payload.events) {
      const event = asRecord(entry);
      if (!event || typeof event.kind !== 'string') continue;
      const parsed = parseVariant(event.kind, decodePayload(event.data));
      if (parsed) out.push(parsed);
    }
    return out;
  }

  const keys = Object.keys(payload);
  if (keys.length !== 1) return [];
  const parsed = parseVariant(keys[0], payload[keys[0]]);
  return parsed ? [parsed] : [];
}

function decodePayload(data: unknown): unknown {
  if (!Array.isArray(data)) return data;
  try {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(data)));
  } catch {
    return null;
  }
}

function parseVariant(kind: string, value: unknown): RichEvent | null {
  const body = asRecord(value);
  const doc = body && typeof body.doc === 'string' ? body.doc : null;
  if (!body || !doc) return null;
  const block = typeof body.block === 'string' ? body.block : null;

  if (kind === 'TitleChanged') return { kind, doc, ids: parseRuns(body.ids) };
  if (!block) return null;
  if (kind === 'TextChanged') {
    return { kind, doc, block, ids: parseRuns(body.ids) };
  }
  if (kind === 'MarkApplied') {
    return typeof body.mark_id === 'string'
      ? { kind, doc, block, markId: body.mark_id }
      : null;
  }
  return BLOCK_KINDS.includes(kind as BlockKind)
    ? { kind: kind as BlockKind, doc, block }
    : null;
}

function parseRuns(value: unknown): Run[] {
  if (!Array.isArray(value)) return [];
  const runs: Run[] = [];
  for (const entry of value) {
    const run = asRecord(entry);
    if (
      run &&
      typeof run.replica === 'string' &&
      typeof run.counter === 'number' &&
      typeof run.len === 'number'
    ) {
      runs.push({ replica: run.replica, counter: run.counter, len: run.len });
    }
  }
  return runs;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
