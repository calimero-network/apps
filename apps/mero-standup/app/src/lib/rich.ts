/**
 * The little formatting a standup needs, and no more: bullet lines, links and
 * `code`. Parsed into plain data so rendering never goes through innerHTML —
 * an update is text a teammate wrote, and it is shown as text.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; text: string };

export type Block =
  | { kind: "para"; inlines: Inline[] }
  | { kind: "list"; items: Inline[][] };

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
const TOKEN = /(`[^`\n]+`)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    if (m[1]) out.push({ kind: "code", text: m[1].slice(1, -1) });
    else if (m[2]) out.push({ kind: "link", href: m[2], text: m[2] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** Consecutive bullet lines become one list; everything else a paragraph. */
export function parseRich(text: string): Block[] {
  const blocks: Block[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (BULLET.test(line)) {
      const item = parseInline(line.replace(BULLET, ""));
      const prev = blocks[blocks.length - 1];
      if (prev?.kind === "list") prev.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
    } else {
      blocks.push({ kind: "para", inlines: parseInline(line) });
    }
  }
  return blocks;
}
