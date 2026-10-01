// The document events the node delivers over SSE, in the two shapes it uses:
// a StateMutation batch whose payloads are JSON bytes, and a single tagged
// variant. Every field is checked, so a stray payload is dropped, not guessed.

const RICH_KINDS = [
  'TitleChanged',
  'TextChanged',
  'BlockInserted',
  'BlockDeleted',
  'BlockMoved',
  'BlockChanged',
  'MarkApplied',
] as const;

const META_KINDS = ['DocTagsChanged', 'DocArchived', 'DocUnarchived']; // change what get_doc returns

type RichKind = (typeof RICH_KINDS)[number];

export type RichEvent =
  | { kind: 'TitleChanged'; doc: string }
  | { kind: Exclude<RichKind, 'TitleChanged'>; doc: string; block: string };

/** Every rich-document event in one delivered SSE payload. */
export function parseRichEvents(data: unknown): RichEvent[] {
  return variants(data).flatMap(([kind, value]) => {
    const parsed = parseVariant(kind, value);
    return parsed ? [parsed] : [];
  });
}

/** The ids of the docs whose tags or archive state changed, from one delivered SSE payload. */
export function parseMetaChanges(data: unknown): string[] {
  return variants(data).flatMap(([kind, value]) => {
    const id = asRecord(value)?.id;
    return META_KINDS.includes(kind) && typeof id === 'string' ? [id] : [];
  });
}

/** Each event in the payload as its variant name and decoded value. */
function variants(data: unknown): [string, unknown][] {
  const payload = asRecord(data);
  if (!payload) return [];

  if (Array.isArray(payload.events)) {
    const out: [string, unknown][] = [];
    for (const entry of payload.events) {
      const event = asRecord(entry);
      if (!event || typeof event.kind !== 'string') continue;
      out.push([event.kind, decodePayload(event.data)]);
    }
    return out;
  }

  const keys = Object.keys(payload);
  return keys.length === 1 ? [[keys[0], payload[keys[0]]]] : [];
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
  const record = asRecord(value);
  const doc = record?.doc;
  if (typeof doc !== 'string' || !RICH_KINDS.includes(kind as RichKind)) {
    return null;
  }
  if (kind === 'TitleChanged') return { kind, doc };
  const block = record?.block;
  return typeof block === 'string'
    ? { kind: kind as Exclude<RichKind, 'TitleChanged'>, doc, block }
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
