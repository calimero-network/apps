/**
 * Who is talking, read from the call page (Google Meet, Zoom in the browser,
 * Microsoft Teams on the web). The content script (`src/content/speakers.ts`)
 * runs these readers on the call tab a few times a second and reports changes;
 * the service worker keeps them as a timeline and names each transcript line
 * after whoever was talking for most of it (`nameFor`).
 *
 * Call pages change their markup without notice, so every platform has more
 * than one way in, tried in order:
 * 1. captions, when they are on: each caption block names its speaker, and the
 *    block whose text is growing is the one talking;
 * 2. the platform's own "speaking" marker on a participant tile;
 * 3. (Meet) activity: the speaking tile's audio bars animate, which shows up as
 *    a burst of class/style changes inside that tile.
 */
import type { Platform } from "./platform";

export interface SpeakerSample {
  /** Names talking now (usually one). */
  speaking: string[];
  /** Everyone the page shows in the call, the recorder included. */
  participants: string[];
  /** The recorder's own name, when the page shows it. */
  self: string | null;
  /** Which reader found the speaker: for diagnostics. */
  via: string | null;
}

export interface SpeakerChange {
  at: number;
  names: string[];
}

// ── names ────────────────────────────────────────────────────────────────────

/** Labels a call page puts next to names, and icon ligatures (Material icons are text). */
const NOT_A_NAME =
  /^(you|me|pin|unpin|more|more options|more_vert|mic|mic_off|videocam|videocam_off|keep|keep_off|present_to_all|presentation|presenting|host|co-host|guest|external|muted|unmuted|speaking|raise hand|frame_person|visual_effects|close|\(you\)|\(host\)|\(guest\))$/i;

/** A display name, tidied: "Ana Horvat (Guest)" → "Ana Horvat"; null when it is not one. */
export function cleanName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let n = raw.replace(/\s+/g, " ").trim();
  n = n.replace(/\s*\((you|host|co-host|guest|external|me|presenting|organi[sz]er)\)\s*$/i, "").trim();
  n = n.replace(/^(presentation|screen) (from|by)\s+/i, "").replace(/\s+is presenting$/i, "").trim();
  if (n.length < 1 || n.length > 60) return null;
  if (NOT_A_NAME.test(n)) return null;
  // Icon ligatures and ids: lowercase_with_underscores, or no letters at all.
  if (/^[a-z0-9_]+$/.test(n) && n.includes("_")) return null;
  if (!/\p{L}/u.test(n)) return null;
  return n;
}

/** The text an element shows itself (not its children's), trimmed. */
function ownText(el: Element): string {
  let t = "";
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 3) t += n.textContent ?? "";
  return t.replace(/\s+/g, " ").trim();
}

/** The first name-like text inside `root`, in document order. */
export function nameIn(root: Element): string | null {
  const walker = root.ownerDocument.createTreeWalker(root, 1 /* SHOW_ELEMENT */);
  for (let el = walker.currentNode as Element | null; el; el = walker.nextNode() as Element | null) {
    if (el.closest("button, [role=button], [aria-hidden=true], i, svg, style, script")) continue;
    const name = cleanName(ownText(el));
    if (name) return name;
  }
  return null;
}

function unique(names: (string | null | undefined)[]): string[] {
  return [...new Set(names.filter((n): n is string => !!n))];
}

// ── captions ─────────────────────────────────────────────────────────────────

interface CaptionBlock {
  name: string;
  text: string;
}

/**
 * Tracks caption blocks between samples: the speaker is whoever's caption text
 * changed since the last sample (captions grow word by word while someone
 * talks), or appeared new.
 */
export class CaptionTracker {
  private last = new Map<string, string>();
  private lastChange = new Map<string, number>();

  constructor(private readonly holdMs = 1_500) {}

  update(blocks: CaptionBlock[], now: number): string[] {
    const seen = new Map<string, string>();
    for (const b of blocks) seen.set(b.name, `${seen.get(b.name) ?? ""}|${b.text}`);
    for (const [name, text] of seen) {
      if (this.last.get(name) !== text) this.lastChange.set(name, now);
    }
    this.last = seen;
    return [...this.lastChange].filter(([name, at]) => seen.has(name) && now - at <= this.holdMs).map(([n]) => n);
  }
}

/** Meet: the captions region, each block an avatar, a name and the words. */
export function meetCaptions(doc: Document): CaptionBlock[] {
  const region =
    doc.querySelector('[role="region"][aria-label*="aption" i]') ??
    doc.querySelector('div[jsname="dsyhDe"]') ??
    doc.querySelector(".a4cQT");
  if (!region) return [];
  const blocks: CaptionBlock[] = [];
  for (const block of Array.from(region.querySelectorAll(":scope > div, :scope > div > div")).filter((b) => b.children.length >= 2)) {
    const img = block.querySelector("img[alt]");
    const name =
      cleanName(block.querySelector(".KcIKyf, .zs7s8d, [class*='speaker' i]")?.textContent) ??
      cleanName(img?.getAttribute("alt")) ??
      firstShortLine(block);
    if (!name) continue;
    const text = (block.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length <= name.length) continue;
    blocks.push({ name, text });
  }
  return blocks;
}

/** The first child line short enough to be a name, when the block has one line for the name and one for the words. */
function firstShortLine(block: Element): string | null {
  for (const child of Array.from(block.querySelectorAll("div, span"))) {
    const t = (child.textContent ?? "").trim();
    if (t && t.length <= 40 && child.children.length === 0) {
      const name = cleanName(t);
      if (name && (block.textContent ?? "").trim().length > t.length + 2) return name;
    }
  }
  return null;
}

/** Teams: live captions, each item an author and its text. */
export function teamsCaptions(doc: Document): CaptionBlock[] {
  const blocks: CaptionBlock[] = [];
  for (const text of Array.from(doc.querySelectorAll('[data-tid="closed-caption-text"]'))) {
    const item = text.closest('.ui-chat__item, [data-tid="closed-caption-message"], li, [role="listitem"]') ?? text.parentElement;
    const name = cleanName(item?.querySelector('[data-tid="author"]')?.textContent);
    if (name) blocks.push({ name, text: (text.textContent ?? "").trim() });
  }
  return blocks;
}

// ── tiles ────────────────────────────────────────────────────────────────────

/** Meet: participant tiles, and the recorder's own. */
export function meetTiles(doc: Document): { name: string; tile: Element; self: boolean }[] {
  const out: { name: string; tile: Element; self: boolean }[] = [];
  for (const tile of Array.from(doc.querySelectorAll("[data-participant-id]"))) {
    // Nested tiles (a tile inside a tile) are the same person.
    if (tile.parentElement?.closest("[data-participant-id]")) continue;
    const selfAttr = tile.querySelector("[data-self-name]")?.getAttribute("data-self-name");
    const name = cleanName(tile.querySelector(".zWGUib, .XEazBc, [data-self-name]")?.textContent) ?? nameIn(tile);
    if (!name) continue;
    out.push({ name, tile, self: !!selfAttr || /\(you\)/i.test(tile.textContent ?? "") });
  }
  return out;
}

/** Zoom web client: the active speaker's name. */
export function zoomSpeaking(doc: Document): string[] {
  const selectors = [
    ".speaker-active-container__video-frame .video-avatar__avatar-name",
    ".speaker-active-container__video-frame .video-avatar__avatar-footer",
    ".speaker-bar-container__video-frame--active .video-avatar__avatar-name",
    ".gallery-video-container__video-frame--active .video-avatar__avatar-name",
    "[class*='video-frame--active'] [class*='avatar-name']",
    "[class*='video-frame--active'] [class*='avatar-footer']",
  ];
  return unique(selectors.flatMap((s) => Array.from(doc.querySelectorAll(s)).map((e) => cleanName(e.textContent))));
}

export function zoomParticipants(doc: Document): string[] {
  return unique(
    Array.from(doc.querySelectorAll(".video-avatar__avatar-name, [class*='avatar-name'], .participants-item__display-name")).map((e) =>
      cleanName(e.textContent),
    ),
  );
}

/** Teams: tiles whose voice-level outline is lit. */
export function teamsSpeaking(doc: Document): string[] {
  const names: (string | null)[] = [];
  for (const ring of Array.from(doc.querySelectorAll('[data-tid="voice-level-stream-outline"]'))) {
    const cls = ring.getAttribute("class") ?? "";
    if (!/vdi-frame-occlusion|speaking/i.test(cls)) continue;
    names.push(teamsTileName(ring));
  }
  for (const el of Array.from(doc.querySelectorAll('[data-is-speaking="true"], [data-tid="speaking-indicator"]'))) names.push(teamsTileName(el));
  return unique(names);
}

function teamsTileName(el: Element): string | null {
  const tile = el.closest('[data-cid="calling-participant-stream"], [data-tid*="participant"], [data-stream-type]') ?? el.parentElement;
  if (!tile) return null;
  return (
    cleanName(tile.querySelector('[data-tid="participant-name"], [data-tid="calling-participant-name"]')?.textContent) ??
    cleanName((tile.getAttribute("aria-label") ?? "").split(",")[0]) ??
    nameIn(tile)
  );
}

export function teamsParticipants(doc: Document): string[] {
  return unique(
    Array.from(doc.querySelectorAll('[data-cid="calling-participant-stream"], [data-tid="participant-name"]')).map((e) =>
      e.matches('[data-tid="participant-name"]') ? cleanName(e.textContent) : cleanName((e.getAttribute("aria-label") ?? "").split(",")[0]),
    ),
  );
}

// ── activity (Meet) ──────────────────────────────────────────────────────────

/**
 * Counts class/style changes per tile over a short window. Meet animates the
 * speaking tile's audio bars by swapping classes many times a second, and a
 * silent tile barely changes, so the busiest tile above a threshold is talking.
 */
export class ActivityTracker {
  private hits: { at: number; tile: Element }[] = [];

  constructor(
    private readonly windowMs = 700,
    private readonly threshold = 4,
  ) {}

  record(target: Node, now: number, tileSelector = "[data-participant-id]"): void {
    const el = target.nodeType === 1 ? (target as Element) : target.parentElement;
    if (!el || el.tagName === "VIDEO" || el.tagName === "CANVAS") return;
    const tile = el.closest(tileSelector);
    if (tile) this.hits.push({ at: now, tile });
  }

  busiest(now: number): Element[] {
    this.hits = this.hits.filter((h) => now - h.at <= this.windowMs);
    const counts = new Map<Element, number>();
    for (const h of this.hits) counts.set(h.tile, (counts.get(h.tile) ?? 0) + 1);
    return [...counts].filter(([, n]) => n >= this.threshold).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }
}

// ── one reading ──────────────────────────────────────────────────────────────

export interface ReaderState {
  captions: CaptionTracker;
  activity: ActivityTracker;
}

export function newReaderState(): ReaderState {
  return { captions: new CaptionTracker(), activity: new ActivityTracker() };
}

/** Who is talking on `doc` now, by the first reader that knows. */
export function readSpeakers(doc: Document, platform: Platform, state: ReaderState, now: number): SpeakerSample {
  if (platform === "meet") {
    const tiles = meetTiles(doc);
    const self = tiles.find((t) => t.self)?.name ?? null;
    const participants = unique(tiles.map((t) => t.name));
    const fromCaptions = state.captions.update(meetCaptions(doc), now);
    if (fromCaptions.length) return { speaking: fromCaptions, participants, self, via: "meet-captions" };
    const busy = state.activity.busiest(now);
    const speaking = unique(busy.map((b) => tiles.find((t) => t.tile === b || t.tile.contains(b) || b.contains(t.tile))?.name)).slice(0, 2);
    return { speaking, participants, self, via: speaking.length ? "meet-tiles" : null };
  }
  if (platform === "teams") {
    const participants = teamsParticipants(doc);
    const fromCaptions = state.captions.update(teamsCaptions(doc), now);
    if (fromCaptions.length) return { speaking: fromCaptions, participants, self: null, via: "teams-captions" };
    const speaking = teamsSpeaking(doc);
    return { speaking, participants, self: null, via: speaking.length ? "teams-tiles" : null };
  }
  if (platform === "zoom") {
    const speaking = zoomSpeaking(doc);
    return { speaking, participants: zoomParticipants(doc), self: null, via: speaking.length ? "zoom-active" : null };
  }
  return { speaking: [], participants: [], self: null, via: null };
}

// ── naming lines ─────────────────────────────────────────────────────────────

/** How far a line may reach past its ends to find its speaker: the page's marker lags the voice a little. */
export const SLACK_MS = 400;

/**
 * The name for a line spoken from `from` to `to` (wall-clock ms): whoever the
 * timeline shows talking for most of it, the recorder (`self`) left out for
 * the call's audio. A call with one other person names that person when the
 * timeline is silent. "" when nobody can be named.
 */
export function nameFor(
  timeline: readonly SpeakerChange[],
  from: number,
  to: number,
  options: { exclude?: string | null; participants?: readonly string[] } = {},
): string {
  const a = from - SLACK_MS;
  const b = Math.max(to, from) + SLACK_MS;
  const exclude = options.exclude ?? null;
  const time = new Map<string, number>();
  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i]!;
    const start = Math.max(a, entry.at);
    const end = Math.min(b, timeline[i + 1]?.at ?? b);
    if (end <= start) continue;
    for (const name of entry.names) {
      if (name === exclude) continue;
      time.set(name, (time.get(name) ?? 0) + (end - start));
    }
  }
  const best = [...time].sort((x, y) => y[1] - x[1])[0];
  if (best && best[1] >= Math.min(600, (b - a) * 0.2)) return best[0];
  const others = (options.participants ?? []).filter((p) => p !== exclude);
  return others.length === 1 ? others[0]! : "";
}

/** Adds a change to the timeline when the names differ from the last entry; keeps it bounded. */
export function pushChange(timeline: SpeakerChange[], change: SpeakerChange, max = 20_000): SpeakerChange[] {
  const last = timeline.at(-1);
  const same = last && last.names.length === change.names.length && last.names.every((n, i) => n === change.names[i]);
  if (same) return timeline;
  const next = [...timeline, change];
  return next.length > max ? next.slice(next.length - max) : next;
}
