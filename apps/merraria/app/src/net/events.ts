// SSE event decoding. Two payload shapes exist in the wild:
//  (a) StateMutation: { newRoot, events: [{ kind: "BlocksChanged", data: u8[] }] }
//      (mero-design decodes this — data bytes are JSON of the variant payload)
//  (b) tagged enum:   { "BlocksChanged": <payload> }
//      (mero-meet's useSubscription sees this)
// Decode both so we work across node versions.

export interface GameEvent {
  kind: string;
  value: unknown;
}

export function decodeSseEvents(data: unknown): GameEvent[] {
  if (data == null || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;

  // shape (a): StateMutation with byte-encoded event payloads
  if (Array.isArray(obj.events)) {
    const out: GameEvent[] = [];
    for (const ev of obj.events as Array<Record<string, unknown>>) {
      if (!ev || typeof ev.kind !== "string") continue;
      let value: unknown = null;
      if (Array.isArray(ev.data)) {
        try {
          const text = new TextDecoder().decode(new Uint8Array(ev.data as number[]));
          value = text ? JSON.parse(text) : null;
        } catch {
          value = null;
        }
      } else if (ev.data !== undefined) {
        value = ev.data;
      }
      out.push({ kind: ev.kind, value });
    }
    return out;
  }

  // shape (b): { "VariantName": payload } — exactly one key
  const keys = Object.keys(obj);
  if (keys.length === 1 && /^[A-Z]/.test(keys[0])) {
    return [{ kind: keys[0], value: obj[keys[0]] }];
  }
  return [];
}
