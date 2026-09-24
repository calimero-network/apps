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

type RichKind = (typeof RICH_KINDS)[number];

export type RichEvent = { kind: RichKind; doc: string };

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
  const doc = asRecord(value)?.doc;
  if (typeof doc !== 'string' || !RICH_KINDS.includes(kind as RichKind)) {
    return null;
  }
  return { kind: kind as RichKind, doc };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
