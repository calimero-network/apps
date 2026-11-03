import type { CalimeroClient } from "@calimero-network/mero-js";

/**
 * The contract (`logic/src/lib.rs`) by method, in the shapes the screens were
 * written against (v1's generated `UpdatesClient`: snake_case fields, numbers).
 *
 * The component ABI answers camelCase with 64-bit integers as decimal strings,
 * and takes camelCase arguments. This file is the one place that difference is
 * absorbed, so no screen had to be rewritten. `updatesClient.test.ts` pins the
 * method lists and parameter names below to the committed `logic/res/abi.json`.
 */

/** Methods that write (through the app's log). */
export const CALLS = [
  "addComment",
  "addTeammate",
  "archiveCategory",
  "askQuestion",
  "createCategory",
  "deleteComment",
  "deleteDraft",
  "deletePost",
  "editCategory",
  "editComment",
  "editUpdate",
  "markRead",
  "offerHelp",
  "publishUpdate",
  "react",
  "removeTeammate",
  "saveDraft",
  "setAskStatus",
  "setMutedCategories",
  "setOfferStatus",
  "setProfile",
  "setQuestionStatus",
  "setSettings",
  "withdrawOffer",
] as const;

/** Methods a node answers without writing. */
export const VIEWS = [
  "getEngagement",
  "getMe",
  "getOverview",
  "getPost",
  "getSettings",
  "listAsks",
  "listCategories",
  "listComments",
  "listContributions",
  "listDrafts",
  "listMetrics",
  "listPeople",
  "listPosts",
] as const;

export type Call = (typeof CALLS)[number];
export type View = (typeof VIEWS)[number];

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

type Transport = Pick<CalimeroClient, "call" | "view">;

/**
 * One audience (an app instance) through the signed-in client. `after` runs
 * after every request, settled or not: the stored session follows the client's
 * refresh-token rotation.
 */
export class UpdatesClient {
  constructor(
    private readonly client: Transport,
    readonly appId: string,
    private readonly after: () => void = () => {},
  ) {}

  private async call<T>(method: Call, args: object = {}): Promise<T> {
    try {
      const { result } = await this.client.call(this.appId, method, toWire(args));
      return fromWire<T>(result);
    } finally {
      this.after();
    }
  }

  private async view<T>(method: View, args: object = {}): Promise<T> {
    try {
      const { result } = await this.client.view(this.appId, method, toWire(args));
      return fromWire<T>(result);
    } finally {
      this.after();
    }
  }

  // ── views ──
  getMe = () => this.view<MeView>("getMe");
  getOverview = () => this.view<Overview>("getOverview");
  getSettings = () => this.view<Settings>("getSettings");
  getEngagement = () => this.view<EngagementRow[]>("getEngagement");
  getPost = (p: { post_id: string }) => this.view<PostView>("getPost", p);
  listAsks = (p: { status: string | null }) => this.view<AskView[]>("listAsks", p);
  listCategories = () => this.view<CategoryView[]>("listCategories");
  listComments = (p: { post_id: string }) => this.view<CommentView[]>("listComments", p);
  /** `since` in unix ms; sent as the decimal string a `u64` argument is. */
  listContributions = (p: { since: number }) =>
    this.view<ContributionView[]>("listContributions", { since: String(Math.max(0, Math.floor(p.since))) });
  listDrafts = () => this.view<DraftView[]>("listDrafts");
  listMetrics = () => this.view<MetricSeries[]>("listMetrics");
  listPeople = () => this.view<PersonView[]>("listPeople");
  listPosts = (p: { kind: string | null; category_id: string | null; cursor: string | null; limit: number }) =>
    this.view<PostPage>("listPosts", p);

  // ── calls ──
  addComment = (p: { post_id: string; parent_id: string | null; body: string }) =>
    this.call<string>("addComment", p);
  addTeammate = (p: { account: string }) => this.call<void>("addTeammate", p);
  archiveCategory = (p: { category_id: string }) => this.call<void>("archiveCategory", p);
  askQuestion = (p: { title: string; body: string; category_id: string | null }) =>
    this.call<string>("askQuestion", p);
  createCategory = (p: { name: string; emoji: string; color: string }) => this.call<string>("createCategory", p);
  deleteComment = (p: { comment_id: string }) => this.call<void>("deleteComment", p);
  deleteDraft = (p: { draft_id: string }) => this.call<void>("deleteDraft", p);
  deletePost = (p: { post_id: string }) => this.call<void>("deletePost", p);
  editCategory = (p: { category_id: string; name: string; emoji: string; color: string }) =>
    this.call<void>("editCategory", p);
  editComment = (p: { comment_id: string; body: string }) => this.call<void>("editComment", p);
  editUpdate = (p: { post_id: string; input: UpdateInput }) => this.call<void>("editUpdate", p);
  markRead = (p: { post_id: string }) => this.call<void>("markRead", p);
  offerHelp = (p: { ask_id: string; note: string }) => this.call<void>("offerHelp", p);
  publishUpdate = (p: { input: UpdateInput }) => this.call<string>("publishUpdate", p);
  react = (p: { post_id: string; emoji: string; on: boolean }) => this.call<void>("react", p);
  removeTeammate = (p: { account: string }) => this.call<void>("removeTeammate", p);
  saveDraft = (p: { draft_id: string | null; title: string; payload: string }) => this.call<string>("saveDraft", p);
  setAskStatus = (p: { ask_id: string; status: string }) => this.call<void>("setAskStatus", p);
  setMutedCategories = (p: { category_ids: string[] }) => this.call<void>("setMutedCategories", p);
  setOfferStatus = (p: { ask_id: string; account: string; status: string }) => this.call<void>("setOfferStatus", p);
  setProfile = (p: { name: string; firm: string }) => this.call<void>("setProfile", p);
  setQuestionStatus = (p: { post_id: string; status: string }) => this.call<void>("setQuestionStatus", p);
  setSettings = (p: { company_name: string; cadence_days: number }) => this.call<void>("setSettings", p);
  withdrawOffer = (p: { ask_id: string }) => this.call<void>("withdrawOffer", p);
}
