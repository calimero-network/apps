// BlockNote styled text on one side, the backend mark set on the other. Keys
// outside MARK_KEYS are dropped: the backend's MarkSchema rejects an undeclared
// key, so shipping one would fail the whole delta.

/** A mark set as the backend renders it: absent key means not set. */
export type MarkAttrs = Record<string, string>;

/** A requested mark change: a null value removes the key. */
export type AttrDelta = Record<string, string | null>;

/** BlockNote's per-character style bag. */
export type BlockNoteStyles = Record<string, unknown>;

/** Every mark key the backend schema declares, sorted. */
export const MARK_KEYS = [
  'backgroundColor',
  'bold',
  'code',
  'comment',
  'italic',
  'link',
  'strike',
  'textColor',
  'underline',
] as const;

/** The keys BlockNote carries as a boolean rather than a string. */
const BOOLEAN_KEYS = new Set(['bold', 'italic', 'underline', 'strike', 'code']);

const KNOWN = new Set<string>(MARK_KEYS);

/** Sorted keys with empty values dropped, so equal sets serialize identically. */
export function canonicalAttrs(attrs: MarkAttrs): MarkAttrs {
  const out: MarkAttrs = {};
  for (const key of Object.keys(attrs).sort()) {
    const value = attrs[key];
    if (KNOWN.has(key) && value) out[key] = value;
  }
  return out;
}

/** BlockNote styles plus an enclosing link href as a canonical mark set. */
export function stylesToAttrs(
  styles: BlockNoteStyles,
  href?: string | null,
): MarkAttrs {
  const attrs: MarkAttrs = {};
  for (const [key, value] of Object.entries(styles)) {
    if (!KNOWN.has(key)) continue;
    if (BOOLEAN_KEYS.has(key)) {
      if (value) attrs[key] = 'true';
    } else if (typeof value === 'string' && value) {
      attrs[key] = value;
    }
  }
  if (href) attrs.link = href;
  return canonicalAttrs(attrs);
}

/** A mark set as BlockNote styles plus the link href it belongs under. */
export function attrsToStyles(attrs: MarkAttrs): {
  styles: BlockNoteStyles;
  href: string | null;
} {
  const styles: BlockNoteStyles = {};
  let href: string | null = null;
  for (const [key, value] of Object.entries(canonicalAttrs(attrs))) {
    if (key === 'link') href = value;
    else if (BOOLEAN_KEYS.has(key)) styles[key] = true;
    else styles[key] = value;
  }
  return { styles, href };
}

/** True when two mark sets carry the same keys and values. */
export function attrsEqual(a: MarkAttrs, b: MarkAttrs): boolean {
  return (
    JSON.stringify(canonicalAttrs(a)) === JSON.stringify(canonicalAttrs(b))
  );
}

/** What to send so `from` becomes `to`: a null value removes the key. */
export function attrDelta(from: MarkAttrs, to: MarkAttrs): AttrDelta {
  const before = canonicalAttrs(from);
  const after = canonicalAttrs(to);
  const delta: AttrDelta = {};
  for (const key of [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].sort()) {
    if (before[key] === after[key]) continue;
    delta[key] = after[key] ?? null;
  }
  return delta;
}
