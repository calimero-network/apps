import { HyperfeedClient, type FeedItem } from "./generated/HyperfeedClient";

const STATUS_LABELS: Record<string, string> = {
  pending: "Waiting for you",
  approved: "Approved · agent working",
  declined: "Declined",
  done: "Done",
  failed: "Failed · needs you",
  retrying: "Retrying",
  undo_requested: "Undo requested",
  undone: "Undone",
};

export type Tone = "wait" | "bad" | "good" | "busy" | "plain";

export function statusOf(item: FeedItem): { label: string; tone: Tone } {
  if (item.kind === "message") {
    if (item.from === "agent" && item.status === "asked") return { label: "Asks you", tone: "wait" };
    if (item.from === "agent" && item.status === "answered") return { label: "You answered", tone: "good" };
    if (item.from === "agent") return { label: item.reply_to ? "Answer" : "Note", tone: "plain" };
    if (item.status === "thinking") return { label: "Your agent is on it", tone: "busy" };
    if (item.status === "answered") return { label: "Answered", tone: "good" };
    if (item.status === "failed") return { label: "Your agent couldn't answer", tone: "bad" };
    return { label: "Sent · waiting for your agent", tone: "busy" };
  }
  if (item.kind === "notification" && item.reply_call) {
    // The feed carries a typed row's answer itself: no agent in between.
    if (item.status === "answered") return { label: "Sending…", tone: "busy" };
    if (item.status === "delivered") return { label: "Sent", tone: "good" };
    if (item.status === "failed") return { label: "Not sent · needs you", tone: "bad" };
  }
  if (item.kind === "notification") {
    if (item.status === "answered") return { label: "Answered · agent sending", tone: "busy" };
    if (item.status === "delivered") return { label: "Answered", tone: "good" };
    if (item.status === "failed") return { label: "Not delivered · needs you", tone: "bad" };
    return item.needs_you ? { label: "Needs you", tone: "wait" } : { label: item.seen ? "Seen" : "New", tone: "plain" };
  }
  // It acted where your rules said to ask: yours to keep or undo, whatever its status.
  if (item.breach && !item.reviewed_at && item.status === "done") return { label: "Acted without asking", tone: "wait" };
  const label = STATUS_LABELS[item.status] ?? item.status;
  const tone: Tone =
    item.status === "pending"
      ? "wait"
      : item.status === "failed"
        ? "bad"
        : item.status === "done"
          ? "good"
          : item.status === "approved" || item.status === "retrying" || item.status === "undo_requested"
            ? "busy"
            : "plain";
  return { label, tone };
}

/** Your decisions in Hyperfeed: the contract takes them from you only, never from your agent. */
const OWNER_METHODS = new Set([
  "resolve_action",
  "answer_notification",
  "say",
  "decide_lens",
  "set_policy",
  "set_guard",
  "set_paused",
  "mark_seen",
  "mark_all_seen",
]);

/** The ones that change your rules: no other app has methods by these names. */
const RULE_METHODS = new Set(["set_policy", "set_guard", "set_paused"]);

/**
 * An action your agent can never carry out, approved or not: one of your own
 * decisions in Hyperfeed (a change to your rules, above all). Retrying it can
 * only fail again; you make it yourself, in Settings → Controls.
 */
export function onlyYouCan(item: FeedItem): boolean {
  const method = bareMethod(item);
  return RULE_METHODS.has(method) || (item.app === "hyperfeed" && OWNER_METHODS.has(method));
}

function bareMethod(item: FeedItem): string {
  return item.method.trim().toLowerCase().replace(/^hyperfeed_/, "");
}

/** Hyperfeed's own methods, as the contract names them: `set_policy`, `say` … */
const HYPERFEED_METHODS = new Set(
  Object.getOwnPropertyNames(HyperfeedClient.prototype)
    .filter((n) => n !== "constructor")
    .map((n) => n.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)),
);

/** How a node, or the tool in front of it, says an app has no such method. */
const NO_SUCH_METHOD = /\bmethod\b[^\n]{0,120}\bnot found\b|\bunknown method\b|\bno such method\b|\bmethod not found\b|\bMethodNotFound\b/i;

/**
 * A failure that names a method the app does not have: one of Hyperfeed's
 * that does not exist, or any app's the node said it could not find. Retrying
 * calls the same method, so it fails the same way.
 */
export function unknownMethod(item: FeedItem): boolean {
  if (item.kind !== "action") return false;
  const method = bareMethod(item);
  if (item.app === "hyperfeed" && method && !HYPERFEED_METHODS.has(method)) return true;
  return NO_SUCH_METHOD.test(item.note);
}

/**
 * A failed action no retry can fix: one only you can make, or a call to a
 * method that does not exist. It offers Archive only: Retry would fail the
 * same way every time, and there is nothing to decline.
 */
export function retryCannotHelp(item: FeedItem): boolean {
  return item.kind === "action" && item.status === "failed" && (onlyYouCan(item) || unknownMethod(item));
}

/** Why a failed row offers no Retry, as one line; "" when it does. */
export function noRetryLine(item: FeedItem, appName: (key: string) => string): string {
  if (!retryCannotHelp(item)) return "";
  if (onlyYouCan(item)) return "Only you can do this, in Settings → Controls. Retrying can't help, so archive it when you're done.";
  return `${appName(item.app)} has no ${item.method}. Retrying can't help, so archive it.`;
}

/** Method verbs said otherwise: a `get_issue` reads an issue. */
const VERBS: Record<string, string> = { get: "Read", view: "Read", lookup: "Look up" };
/** Verbs that name one known thing: "Set the summary", not "Set a summary". */
const THE = new Set(["set", "get", "read", "view", "edit", "update", "change", "clear", "describe", "lookup", "rename"]);

/**
 * A method as a person says it: `set_summary` is "Set the summary",
 * `create_issue` "Create an issue", `list_issues` "List issues". The same
 * words mero-bot titles your agent's rows with.
 */
export function plainMethod(method: string): string {
  const [verb, ...rest] = method.trim().toLowerCase().split(/[_\s]+/).filter(Boolean);
  if (!verb) return "";
  const said = VERBS[verb] ?? `${verb.charAt(0).toUpperCase()}${verb.slice(1)}`;
  if (rest.length === 0) return said;
  const thing = rest.join(" ");
  const plural = verb === "list" || /[^s]s$/.test(thing);
  const article = plural ? "" : THE.has(verb) ? "the " : /^[aeiou]/.test(thing) ? "an " : "a ";
  return `${said} ${article}${thing}`;
}

/** How long a headline the app derives may be: the contract's limit on one the agent writes. */
export const HEADLINE_MAX = 80;
/** A first sentence shorter than this says too little alone: the next one joins it. */
const SHORT_SENTENCE = 24;

/**
 * A text's first sentence, as a headline of at most {@link HEADLINE_MAX}
 * characters: its first line that says anything, without markdown's heading
 * and list marks or emphasis, up to the first full stop, question or
 * exclamation mark (with the next sentence when the first is a word or two,
 * "Posted."), cut at a word with "…" when still too long.
 */
export function firstSentence(text: string, max = HEADLINE_MAX): string {
  const line =
    text
      .split("\n")
      .map((l) => l.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s*|\d+[.)]\s+)/, "").replace(/[*_`]{1,3}/g, "").trim())
      .find((l) => l) ?? "";
  // Sentences of the line, in order; a short first one ("Posted.") takes the next while they fit.
  const sentences = line.split(/(?<=[.!?])\s+/).filter(Boolean);
  let sentence = sentences[0] ?? line;
  for (const next of sentences.slice(1)) {
    if ([...sentence].length >= SHORT_SENTENCE || [...`${sentence} ${next}`].length > max) break;
    sentence = `${sentence} ${next}`;
  }
  if ([...sentence].length <= max) return sentence;
  const cut = [...sentence].slice(0, max - 1).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * A message's headline: the one your agent (or you) wrote with it, else its
 * first sentence. Any other row's title, as it is.
 */
export function headlineOfMessage(item: FeedItem): string {
  if (item.kind !== "message") return item.title;
  if (item.headline) return item.headline;
  return firstSentence(item.body) || item.title;
}

/**
 * Whether a message says more than its headline: then the row shows the
 * headline, and the body is behind "More".
 */
export function saysMore(item: FeedItem): boolean {
  if (item.kind !== "message") return false;
  const body = item.body.trim();
  return Boolean(body) && body !== headlineOfMessage(item).replace(/…$/, "").trim();
}

/**
 * A row's title. Your agent's older rows were titled with the bare method
 * ("set summary in issue-tracker"): those are said in plain words, "Set the
 * summary in Issue tracker". A message's title is its headline (see
 * {@link headlineOfMessage}). Every other title is the row's own.
 */
export function rowTitle(item: FeedItem, appName: (key: string) => string): string {
  if (item.kind === "message") return headlineOfMessage(item);
  if (item.kind !== "action" || !item.method) return item.title;
  const bare = item.method.replace(/_/g, " ");
  if (item.title === `${bare} on the node`) return `${plainMethod(item.method)} on the node`;
  if (item.title === `${bare} in ${item.app}`) return `${plainMethod(item.method)} in ${appName(item.app)}`;
  return item.title;
}

/**
 * The command behind a row for a tool your agent ran on your computer, or ""
 * for any other row. The title already says what and where; the command is
 * folded away behind Details.
 */
export function localCommand(item: FeedItem): string {
  if (item.kind !== "action" || item.app !== "mero-bot" || item.source_label !== "This computer") return "";
  return item.body.trim();
}

/**
 * Which plain buttons a row offers, straight from the contract's transitions.
 * A proposal with an ask is approved through its resolver instead (pick an
 * option, edit and send), so it offers no bare Approve. A failure no retry can
 * fix offers neither Retry nor Decline: `archive` says Archive is its way out.
 */
export function choicesFor(item: FeedItem): { approve?: string; decline: boolean; undo: boolean; keep: boolean; archive: boolean } {
  if (item.kind !== "action") return { decline: false, undo: false, keep: false, archive: false };
  const pending = item.status === "pending";
  const deadEnd = retryCannotHelp(item);
  return {
    approve: pending && !item.ask.kind ? "Approve" : item.status === "failed" && !deadEnd ? "Retry" : undefined,
    decline: pending || (item.status === "failed" && !deadEnd),
    undo: item.status === "done" && item.undoable,
    keep: item.breach !== "",
    archive: deadEnd,
  };
}

/** Whether the row should show its in-place resolver right now. */
export function resolvable(item: FeedItem): boolean {
  if (!item.ask.kind) return false;
  // A newer question replaced it: its buttons are gone.
  if (item.superseded_by && item.status !== "failed") return false;
  if (item.kind === "action") return item.status === "pending";
  // Your agent's question: open until you say something in its chain.
  if (item.kind === "message") return item.status === "asked";
  return item.status === "received" || item.status === "failed";
}

export type Actor = "agent" | "you" | "app";

/** One line of a chain's flow. */
export interface FlowStep {
  key: string;
  item: FeedItem;
  actor: Actor;
  /** Who, as a person reads it: "Your agent", "You", "Maya Ortiz". */
  who: string;
  text: string;
  detail: string;
  at: number;
  tone: Tone;
  /** The row's first step: the one that names what it is about. */
  first: boolean;
}

function quoteOf(text: string): string {
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

/** Every step of one row, as the flow tells it. */
export function stepsOf(item: FeedItem, appName: string): FlowStep[] {
  const out: FlowStep[] = [];
  const add = (i: number, actor: Actor, who: string, text: string, detail: string, at: number, tone: Tone) =>
    out.push({ key: `${item.id}:${i}`, item, actor, who, text, detail, at, tone, first: i === 0 });
  item.history.forEach((step, i) => {
    const note = step.note;
    if (item.kind === "message") {
      const mine = item.from === "you";
      // A long message, written with a headline, is told by it: its row and the chat have the whole text.
      if (i === 0 && item.headline) add(i, mine ? "you" : "agent", mine ? "You" : "Your agent", item.headline, quoteOf(item.body), step.at, mine ? "plain" : "good");
      else if (i === 0) add(i, mine ? "you" : "agent", mine ? "You" : "Your agent", item.body, "", step.at, mine ? "plain" : "good");
      // Picking it up only matters while nothing else has happened; the
      // answer is a message of its own.
      else if (step.status === "thinking" && i === item.history.length - 1)
        add(i, "agent", "Your agent", "Is on it…", "", step.at, "busy");
      else if (step.status === "failed") add(i, "agent", "Your agent", "Couldn't answer", note, step.at, "bad");
      return;
    }
    if (item.kind === "notification") {
      switch (step.status) {
        case "received":
          add(i, "app", item.from || appName, item.title, item.body, step.at, "plain");
          break;
        case "answered": {
          const text =
            item.ask.kind === "reply"
              ? `Replied${item.from ? ` to ${item.from}` : ""}`
              : item.ask.kind === "choose"
                ? `Chose "${note}"`
                : item.ask.prompt || "Confirmed";
          add(i, "you", "You", text, item.ask.kind === "reply" ? quoteOf(note) : "", step.at, "busy");
          break;
        }
        case "delivered":
          add(i, "agent", "Your agent", note || "Delivered it", "", step.at, "good");
          break;
        case "failed":
          add(i, "agent", "Your agent", "Couldn't deliver it", note, step.at, "bad");
          break;
      }
      return;
    }
    if (i === 0) {
      const title = rowTitle(item, () => appName);
      const text = step.status === "pending" ? `Proposed: ${title}` : step.status === "failed" ? `Tried: ${title}` : title;
      // A command is folded away, not told in the flow.
      add(i, "agent", "Your agent", text, step.status === "failed" ? note : localCommand(item) ? "" : item.body, step.at, step.status === "failed" ? "bad" : step.status === "pending" ? "wait" : "good");
      return;
    }
    switch (step.status) {
      case "approved":
        add(i, "you", "You", note ? (item.ask.kind === "choose" ? `Picked "${note}"` : "Approved, edited") : "Approved", item.ask.kind === "reply" ? quoteOf(note) : "", step.at, "busy");
        break;
      case "declined":
        add(i, "you", "You", "Declined", "", step.at, "plain");
        break;
      case "retrying":
        add(i, "you", "You", "Asked to retry", "", step.at, "busy");
        break;
      case "undo_requested":
        add(i, "you", "You", "Asked to undo it", "", step.at, "busy");
        break;
      case "done":
        add(i, "agent", "Your agent", note || "Done", "", step.at, "good");
        break;
      case "failed":
        add(i, "agent", "Your agent", "Failed", note, step.at, "bad");
        break;
      case "undone":
        add(i, "agent", "Your agent", note || "Undid it", "", step.at, "plain");
        break;
    }
  });
  if (item.reviewed_at > 0) {
    out.push({ key: `${item.id}:kept`, item, actor: "you", who: "You", text: "Kept it", detail: "", at: item.reviewed_at, tone: "plain", first: false });
  }
  return out;
}

/** A whole chain's flow, oldest first. */
export function flowOf(items: FeedItem[], appName: (key: string) => string): FlowStep[] {
  return items
    .flatMap((i) => stepsOf(i, appName(i.app)))
    .sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today", "Yesterday", or the date. */
export function dayLabel(at: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

/**
 * Your agent's latest step on a message it is working on, with how long ago
 * it started: "Running the tests · 12 s ago". Empty when there is none.
 */
export function progressLine(item: FeedItem, now = Date.now()): string {
  if (item.kind !== "message" || item.status !== "thinking" || !item.doing) return "";
  const secs = Math.max(0, Math.round((now - item.doing_at) / 1000));
  const ago = secs < 5 ? "just now" : secs < 60 ? `${secs} s ago` : `${Math.floor(secs / 60)} min ago`;
  return `${item.doing} · ${ago}`;
}

/** "just now", "4 min", "14:02". */
export function timeLabel(at: number, now = Date.now()): string {
  const mins = Math.floor((now - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min`;
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function groupByDay(items: FeedItem[], now = Date.now()): { label: string; items: FeedItem[] }[] {
  const groups: { label: string; items: FeedItem[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.at, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function short(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

export const GUARD_LABELS: Record<string, string> = {
  sign: "Signing anything",
  money: "Spending or moving money",
  new_contact: "Messaging someone new",
  delete: "Deleting anything",
  invite: "Inviting people or changing roles",
  secret: "Reading a secret",
};

/** What a typed row is, as a word on its card. */
export const TYPE_LABELS: Record<string, string> = {
  message: "Message",
  assignment: "Assignment",
  poll: "Poll",
  invite: "Invite",
  turn: "Your turn",
  request: "Request",
  change: "Change",
  status: "Status",
  other: "Update",
};

/** A typed row's fields, or {} when it has none or they do not parse. */
export function fieldsOf(item: FeedItem): Record<string, unknown> {
  if (!item.fields) return {};
  try {
    const f = JSON.parse(item.fields) as unknown;
    return f && typeof f === "object" && !Array.isArray(f) ? (f as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The facts a typed card shows under its title, by type: label and value. */
export function typedFacts(item: FeedItem): [string, string][] {
  const f = fieldsOf(item);
  const text = (k: string) => (typeof f[k] === "string" ? (f[k] as string) : typeof f[k] === "number" ? String(f[k]) : "");
  const pick = (...pairs: [string, string][]) => pairs.filter(([, v]) => v);
  switch (item.item_type) {
    case "assignment":
      return pick(["What", text("what")], ["Due", text("due")]);
    case "poll":
      return pick(["Closes", text("closes_at")]);
    case "invite":
      return pick(["What", text("what")], ["When", text("when")], ["Where", text("where")]);
    case "turn":
      return pick(["Game", text("game")], ["Last move", text("last_move")]);
    case "request":
      return pick(["Asks for", text("asks_for")]);
    case "change":
      return pick(["What", text("what")]);
    default:
      return [];
  }
}

/** Where a row stands for you: something to do, something underway, or done. */
export type Lane = "todo" | "progress" | "done";

/**
 * A chain's lane, from its lead row: it needs you (to do); your agent or the
 * feed is still carrying it (in progress: a message being answered, an
 * approved action being done, your answer being sent); or it is settled.
 */
export function laneOf(item: FeedItem): Lane {
  if (item.needs_you) return "todo";
  if (item.kind === "message") {
    return item.from === "you" && (item.status === "waiting" || item.status === "thinking") ? "progress" : "done";
  }
  if (item.kind === "action") return ["approved", "retrying", "undo_requested"].includes(item.status) ? "progress" : "done";
  if (item.kind === "notification") return item.status === "answered" ? "progress" : "done";
  return "done";
}

/** What a question a newer one replaced says where its buttons were. */
export const REPLACED = "Replaced by a newer question";

/**
 * Who is working on a chat's chain right now, from its message's lease:
 * "mero-bot on studio · 2 min". "" when nobody holds it.
 */
export function heldLine(item: Pick<FeedItem, "held_by" | "held_since"> | undefined, now = Date.now()): string {
  const who = item?.held_by?.trim();
  if (!who) return "";
  const at = who.lastIndexOf("@");
  const name = at > 0 ? `${who.slice(0, at)} on ${who.slice(at + 1)}` : who;
  const mins = Math.max(0, Math.floor((now - (item?.held_since ?? now)) / 60_000));
  return `${name} · ${mins < 1 ? "just now" : mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h`}`;
}

/** Where one argument starts in a write's body, as mero-bot writes it: `key: value`, joined by " · ". */
const ARG_START = /(?:^| · )([A-Za-z_][\w.-]{0,63}): /g;

/**
 * What a write in an app sends, as a person reads it. mero-bot keeps the
 * call's arguments as the row's body (`message: <p>Hi</p> · thread: 4`), which
 * is also how it tells a write already landed, so the body stays as it is and
 * only its display changes: one argument shows as its text alone, several as
 * one line each, and HTML in a value as the text it shows. A local command, a
 * hand-off and a body not in that shape show unchanged.
 */
export function writeText(item: FeedItem): string {
  const body = item.body.trim();
  if (item.kind !== "action" || item.app === "mero-bot" || !body) return body;
  const starts = [...body.matchAll(ARG_START)];
  if (starts[0]?.index !== 0) return body;
  const args = starts.map((m, i) => {
    const from = m.index! + m[0].length;
    const to = i + 1 < starts.length ? starts[i + 1]!.index! : body.length;
    return { key: m[1]!, text: htmlText(body.slice(from, to).trim()) };
  });
  if (args.length === 1) return args[0]!.text;
  return args.map((a) => `${a.key}: ${a.text}`).join("\n");
}

/** HTML as the text it shows, its paragraphs and breaks as new lines; anything else as it is. */
export function htmlText(value: string): string {
  if (!/<\/?[a-z][^>]*>/i.test(value)) return value;
  const marked = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|pre|tr)>/gi, "\n");
  // Parsed, never put on the page: no script in it runs, and entities read as their characters.
  const text =
    typeof DOMParser === "undefined"
      ? marked.replace(/<[^>]*>/g, "")
      : (new DOMParser().parseFromString(marked, "text/html").body.textContent ?? "");
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
