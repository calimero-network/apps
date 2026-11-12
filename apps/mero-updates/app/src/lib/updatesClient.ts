/**
 * The shapes the screens were written against (v1's generated `UpdatesClient`:
 * snake_case fields, numbers), and the one place the component wire is turned
 * into them.
 *
 * The contract is called through `MeroUpdatesClient`, which `mero-app-build
 * codegen` writes from logic/res/abi.json (`src/generated/client.ts`), with
 * camelCase arguments (`UpdateInput` through `toWireInput`, a u64 through
 * `u64`), typed from the ABI's record shapes. Every answer goes through
 * `fromWire<T>`, which turns its camelCase keys back into snake_case and its
 * u64 strings into numbers.
 */

import type { UpdateInput as WireUpdateInput } from "../generated/client";

// ── the shapes the screens render ────────────────────────────────────────────

export interface Section {
  kind: string;
  title: string;
  body: string;
}

export interface Metric {
  name: string;
  value: string;
  unit: string;
}

export interface AskInput {
  /** Set to edit an existing ask of this update; `null` creates one. */
  id: string | null;
  kind: string;
  title: string;
  detail: string;
}

export interface UpdateInput {
  title: string;
  summary: string;
  category_id: string;
  sections: Section[];
  metrics: Metric[];
  asks: AskInput[];
}

export interface MeView {
  account: string;
  name: string;
  firm: string;
  is_admin: boolean;
  is_team: boolean;
  muted: string[];
}

export interface PersonView {
  account: string;
  name: string;
  firm: string;
  is_admin: boolean;
  is_team: boolean;
  joined_at: number;
  updates_read: number;
  updates_total: number;
  last_read_at: number;
  comments: number;
  offers: number;
  accepted_offers: number;
}

export interface CategoryView {
  id: string;
  name: string;
  emoji: string;
  color: string;
  update_count: number;
  unread_count: number;
  muted: boolean;
}

export interface ReactionCount {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface OfferView {
  ask_id: string;
  account: string;
  name: string;
  firm: string;
  note: string;
  status: string;
  created_at: number;
  updated_at: number;
}

export interface AskView {
  id: string;
  post_id: string;
  post_title: string;
  kind: string;
  title: string;
  detail: string;
  status: string;
  created_at: number;
  offer_count: number;
  /** Every offer, for the team only; empty for readers. */
  offers: OfferView[];
  /** The caller's own offer, if any. */
  my_offer: OfferView | null;
}

export interface PostCard {
  id: string;
  kind: string;
  author: string;
  author_name: string;
  author_is_team: boolean;
  title: string;
  summary: string;
  category_id: string;
  status: string;
  created_at: number;
  edited_at: number;
  comment_count: number;
  ask_count: number;
  open_ask_count: number;
  metric_count: number;
  read_count: number;
  read_by_me: boolean;
  reactions: ReactionCount[];
}

export interface PostView {
  card: PostCard;
  sections: Section[];
  metrics: Metric[];
  asks: AskView[];
}

export interface PostPage {
  items: PostCard[];
  next_cursor: string | null;
}

export interface CommentView {
  id: string;
  post_id: string;
  parent_id: string;
  author: string;
  author_name: string;
  author_is_team: boolean;
  body: string;
  created_at: number;
  edited_at: number;
}

export interface MetricPoint {
  post_id: string;
  post_title: string;
  at: number;
  value: string;
}

export interface MetricSeries {
  name: string;
  unit: string;
  points: MetricPoint[];
}

export interface ContributionView {
  ask_id: string;
  ask_title: string;
  ask_kind: string;
  account: string;
  name: string;
  firm: string;
  note: string;
  accepted_at: number;
}

export interface Overview {
  company_name: string;
  cadence_days: number;
  last_update_at: number;
  next_due_at: number;
  updates_total: number;
  unread_updates: number;
  open_asks: number;
  open_questions: number;
  people: number;
  is_team: boolean;
}

export interface Settings {
  company_name: string;
  cadence_days: number;
  updated_at: number;
}

export interface ReaderView {
  account: string;
  name: string;
  firm: string;
  first_at: number;
}

export interface EngagementRow {
  post_id: string;
  title: string;
  category_id: string;
  published_at: number;
  readers: ReaderView[];
  not_read: ReaderView[];
  reactions: number;
  comments: number;
  offers: number;
}

export interface DraftView {
  id: string;
  title: string;
  payload: string;
  updated_at: number;
}

// ── the wire ─────────────────────────────────────────────────────────────────

/**
 * Every field the contract sends as a `u64` (a decimal string), by its
 * snake_case name. Only strings under these names become numbers: a metric's
 * `value` ("12") or an all-digit id stays a string.
 */
const U64_FIELDS = new Set([
  "accepted_at",
  "accepted_offers",
  "ask_count",
  "at",
  "comment_count",
  "comments",
  "count",
  "created_at",
  "edited_at",
  "first_at",
  "joined_at",
  "last_read_at",
  "last_update_at",
  "metric_count",
  "next_due_at",
  "offer_count",
  "offers",
  "open_ask_count",
  "open_asks",
  "open_questions",
  "people",
  "published_at",
  "reactions",
  "read_count",
  "unread_count",
  "unread_updates",
  "update_count",
  "updated_at",
  "updates_read",
  "updates_total",
]);

const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** A contract answer as the screens read it: snake_case keys, `u64` strings as numbers. */
export function fromWire<T>(value: unknown): T {
  return convertIn(value) as T;
}

function convertIn(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(convertIn);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const name = snake(key);
    out[name] =
      typeof v === "string" && U64_FIELDS.has(name) && /^\d+$/.test(v) ? Number(v) : convertIn(v);
  }
  return out;
}

/** Arguments as the contract takes them: camelCase keys at every level. */
export function toWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toWire);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[camel(key)] = toWire(v);
  }
  return out;
}

/** `publishUpdate` / `editUpdate`'s `input` as the contract takes it (camelCase). */
export function toWireInput(input: UpdateInput): WireUpdateInput {
  return {
    title: input.title,
    summary: input.summary,
    categoryId: input.category_id,
    sections: input.sections.map(({ kind, title, body }) => ({ kind, title, body })),
    metrics: input.metrics.map(({ name, value, unit }) => ({ name, value, unit })),
    asks: input.asks.map(({ id, kind, title, detail }) => ({ id, kind, title, detail })),
  };
}

/** A number the contract takes as a u64: the decimal string of its whole, non-negative part. */
export const u64 = (n: number): string => String(Math.max(0, Math.floor(n)));
