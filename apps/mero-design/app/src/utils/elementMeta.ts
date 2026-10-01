import type { BoxKind, Element, ShapeKind, StrokeStyle } from "../types";

/**
 * Extra per-element properties the contract has no field for, carried inside
 * `label`.
 *
 * WHY NOT A CONTRACT FIELD
 *
 * `Element` is stored as one Borsh leaf. Adding a field to it changes the byte
 * layout of every element already on every board, so the new wasm could not
 * read old state without an `#[app::migrate]` — and until every node in a
 * context runs the new bundle, peers disagree about what an element even is.
 * The groups and screens features ride `label` for the same reason (see
 * `groups.ts`): it is a free-form string the contract already stores, syncs and
 * lets any editor rewrite with `update_element_label`.
 *
 * THE FORMAT
 *
 *   <visible label>\u001F<key>=<value>&<key>=<value>
 *
 * U+001F (unit separator) cannot be typed into a name field and `sanitizeName`
 * never produces it, so the split is unambiguous. Values are URL-encoded.
 * Everything before the separator is the label exactly as the groups code has
 * always seen it.
 *
 * ⚠️ PACKED ONLY AT THE WIRE. `api/rpc.ts` unpacks every element it reads and
 * packs every element and label it writes, so the store, the canvas and the
 * groups/screens code only ever see the clean label plus typed fields. Anything
 * that writes a label outside `rpcCall` would silently drop these extras.
 */

export const META_SEPARATOR = "\u001F";

const STROKE_STYLES: readonly StrokeStyle[] = ["solid", "dashed", "dotted", "dashdot", "dotted3", "long"];
const BOX_KINDS: readonly BoxKind[] = ["box", "sticky"];
const SHAPE_KINDS: readonly ShapeKind[] = ["triangle", "diamond", "star", "cloud"];

/** The extras, as they appear on an Element. */
export interface ElementMeta {
  strokeStyle?: StrokeStyle;
  box?: BoxKind;
  textColor?: string;
  shape?: ShapeKind;
  startBinding?: string;
  endBinding?: string;
}

/** Short wire keys: a label is synced to every peer on every rename. */
const KEYS = {
  strokeStyle: "s",
  box: "b",
  textColor: "c",
  shape: "h",
  startBinding: "f",
  endBinding: "t",
} as const satisfies Record<keyof ElementMeta, string>;

const oneOf = <T extends string>(allowed: readonly T[], v: string | null): T | undefined =>
  v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

/** Split a stored label into the visible label and its extras. */
export function unpackLabel(raw: string | null | undefined): { label: string | null; meta: ElementMeta } {
  if (raw == null) return { label: null, meta: {} };
  const at = raw.indexOf(META_SEPARATOR);
  if (at === -1) return { label: raw, meta: {} };

  const visible = raw.slice(0, at);
  const params = new URLSearchParams(raw.slice(at + 1));
  const meta: ElementMeta = {};
  const strokeStyle = oneOf(STROKE_STYLES, params.get(KEYS.strokeStyle));
  if (strokeStyle && strokeStyle !== "solid") meta.strokeStyle = strokeStyle;
  const box = oneOf(BOX_KINDS, params.get(KEYS.box));
  if (box) meta.box = box;
  const textColor = params.get(KEYS.textColor);
  if (textColor) meta.textColor = textColor;
  const shape = oneOf(SHAPE_KINDS, params.get(KEYS.shape));
  if (shape) meta.shape = shape;
  const startBinding = params.get(KEYS.startBinding);
  if (startBinding) meta.startBinding = startBinding;
  const endBinding = params.get(KEYS.endBinding);
  if (endBinding) meta.endBinding = endBinding;
  // An element that only carries extras has no visible name — the groups code
  // treats that as null and derives one ("rect", the text, …).
  return { label: visible === "" ? null : visible, meta };
}

/** Join a visible label and extras back into what the contract stores. */
export function packLabel(label: string | null | undefined, meta: ElementMeta): string | null {
  const params = new URLSearchParams();
  if (meta.strokeStyle && meta.strokeStyle !== "solid") params.set(KEYS.strokeStyle, meta.strokeStyle);
  if (meta.box) params.set(KEYS.box, meta.box);
  if (meta.textColor) params.set(KEYS.textColor, meta.textColor);
  if (meta.shape) params.set(KEYS.shape, meta.shape);
  if (meta.startBinding) params.set(KEYS.startBinding, meta.startBinding);
  if (meta.endBinding) params.set(KEYS.endBinding, meta.endBinding);
  const packed = params.toString();
  // No extras: byte-for-byte what was stored before this existed, so boards
  // that never use a new feature never see a changed label.
  if (!packed) return label ?? null;
  return `${label ?? ""}${META_SEPARATOR}${packed}`;
}

/** The extras an element currently carries. */
export function metaOf(el: Partial<ElementMeta>): ElementMeta {
  const meta: ElementMeta = {};
  if (el.strokeStyle && el.strokeStyle !== "solid") meta.strokeStyle = el.strokeStyle;
  if (el.box) meta.box = el.box;
  if (el.textColor) meta.textColor = el.textColor;
  if (el.shape) meta.shape = el.shape;
  if (el.startBinding) meta.startBinding = el.startBinding;
  if (el.endBinding) meta.endBinding = el.endBinding;
  return meta;
}

/** A stored element → the shape the app works with. Idempotent. */
export function fromWire<T extends Element>(el: T): T {
  if (!el || typeof el !== "object") return el;
  const { label, meta } = unpackLabel(el.label);
  if (label === (el.label ?? null) && Object.keys(meta).length === 0) return el;
  const out: T = { ...el, label };
  delete out.strokeStyle;
  delete out.box;
  delete out.textColor;
  delete out.shape;
  delete out.startBinding;
  delete out.endBinding;
  return Object.assign(out, meta);
}

/** An app element → what the contract stores: extras folded into `label`. */
export function toWire(el: Element): Element {
  const { strokeStyle: _s, box: _b, textColor: _c, shape: _h, startBinding: _f, endBinding: _t, ...rest } = el;
  const meta = metaOf(el);
  // Untouched when there is nothing to pack, `undefined` included.
  if (Object.keys(meta).length === 0) return rest;
  return { ...rest, label: packLabel(el.label, meta) };
}
