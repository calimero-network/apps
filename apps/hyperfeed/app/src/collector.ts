import type { NotificationInput } from "./generated/HyperfeedClient";

/**
 * Turning another app's live events into Hyperfeed notifications.
 *
 * Every app on your node emits events as its state changes, and your node
 * streams them to any client subscribed to that context. An event is a `kind`
 * (`MessageSent`, `UpdatePublished`, …) plus JSON bytes the app chose; core
 * does not say who caused it or whether it concerns you. So this is a
 * best-effort reading: a few well-known kinds get a proper sentence and the
 * "needs you" flag, and anything else is filed under its kind, humanised.
 *
 * The dedupe key is `<context>:<new root hash>:<index>`. Every device watching
 * the same context sees the same root hash for the same change, so the
 * contract records the event once however many of your devices saw it.
 */

/** The `data` of a `StateMutation` context event. */
export interface StateMutation {
  newRoot?: string;
  events?: { kind?: string; data?: number[] | string | null }[];
}

export interface SourceContext {
  contextId: string;
  appKey: string;
  label: string;
}

interface Reading {
  title: string;
  body: string;
  from: string;
  needsYou: boolean;
}

/** Events that are bookkeeping, not news: a read marker, presence, a reaction. */
const QUIET = new Set(["Read", "Seen", "Heartbeat", "Presence", "ProfileSet", "ReactionUpdated", "Reacted"]);

const KNOWN: Record<string, (payload: Record<string, unknown>) => Partial<Reading>> = {
  MessageSent: (p) => ({
    title: p.channel ? `New message in ${String(p.channel)}` : "New message",
    body: text(p.text ?? p.message ?? p.content),
    from: text(p.sender ?? p.author),
    needsYou: Boolean(p.mentions_me ?? p.mentioned),
  }),
  MessageSentThread: (p) => ({ title: "New reply in a thread", body: text(p.text) }),
  UpdatePublished: () => ({ title: "Published an update" }),
  QuestionAsked: () => ({ title: "Asked a question", needsYou: true }),
  Commented: () => ({ title: "New comment" }),
  IssueAssigned: (p) => ({ title: "Assigned an issue to you", body: text(p.title), needsYou: true }),
  IssueCreated: (p) => ({ title: "Filed an issue", body: text(p.title) }),
  Moved: () => ({ title: "Your opponent moved", needsYou: true }),
  GameEnded: () => ({ title: "A game ended" }),
};

function text(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 500) : "";
}

/** `IssueAssigned` → `Issue assigned`. */
export function humanise(kind: string): string {
  const words = kind.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The JSON object an event carries, or `{}` when it carries something else. */
export function decodePayload(data: number[] | string | null | undefined): Record<string, unknown> {
  if (data == null) return {};
  try {
    const raw = typeof data === "string" ? data : new TextDecoder().decode(Uint8Array.from(data));
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function toNotifications(source: SourceContext, mutation: StateMutation): NotificationInput[] {
  const root = mutation.newRoot ?? "";
  if (!root) return []; // no stable key, and recording it twice is worse than not at all
  const out: NotificationInput[] = [];
  (mutation.events ?? []).forEach((event, index) => {
    const kind = event.kind ?? "";
    if (!kind || QUIET.has(kind)) return;
    const reading = KNOWN[kind]?.(decodePayload(event.data)) ?? {};
    out.push({
      key: `${source.contextId}:${root}:${index}`.slice(0, 200),
      app: source.appKey,
      source_context: source.contextId,
      source_label: source.label.slice(0, 120),
      from: (reading.from ?? "").slice(0, 120),
      title: (reading.title || humanise(kind)).slice(0, 200),
      body: (reading.body ?? "").slice(0, 2000),
      event: kind.slice(0, 120),
      needs_you: reading.needsYou ?? false,
    });
  });
  return out;
}
