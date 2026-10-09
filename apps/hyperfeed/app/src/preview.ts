import type { LensView } from "./generated/HyperfeedClient";
import { parseLens, runLens, type LensHost, type Outcome } from "./lens/lens";
import type { NodeFeed } from "./useNodeFeed";

/** What a lens would do with one event: shown before you approve it. */
export interface PreviewRow {
  kind: string;
  outcome: Outcome;
}

export type Preview = (lens: LensView) => Promise<PreviewRow[]>;

/** How many recent events a preview runs on. */
const PREVIEW_EVENTS = 10;

async function preview(lens: LensView, events: { kind: string; payload: unknown; contextId: string }[], hostFor: (ctx: string) => LensHost | null) {
  let spec;
  try {
    spec = parseLens(lens.spec);
  } catch (e) {
    return [{ kind: "lens", outcome: { kind: "error", why: e instanceof Error ? e.message : String(e) } as Outcome }];
  }
  const rows: PreviewRow[] = [];
  for (const e of events.slice(-PREVIEW_EVENTS).reverse()) {
    const host = hostFor(e.contextId);
    if (!host) continue;
    const source = { contextId: e.contextId, appKey: lens.app, label: `${lens.app} · ${e.contextId.slice(0, 6)}` };
    rows.push({ kind: e.kind, outcome: await runLens(spec, e.kind, e.payload, source, host) });
  }
  return rows;
}

/** On a node: the lens over the last events that app version emitted while the feed was open. */
export function nodePreview(node: Pick<NodeFeed, "recent" | "hostFor">): Preview {
  return (lens) => preview(lens, node.recent(lens.app, lens.application_id), node.hostFor);
}

/** In the demo: a few events Chat and Vote might have emitted, against a pretend app. */
export function demoPreview(): Preview {
  const host: LensHost = {
    me: async () => new Set(["you"]),
    name: async (id) => ({ maya: "Maya Ortiz", priya: "Priya Nair" })[id] ?? "",
    call: async <T,>(method: string, args: Record<string, unknown>) => {
      const messages = [
        { id: "m1", sender: "maya", text: "<p>@you can you check the deck?</p>", mentions: ["you"], mentions_usernames: [], deleted: null },
        { id: "m2", sender: "priya", text: "<p>lunch at 1?</p>", mentions: [], mentions_usernames: [], deleted: null },
        { id: "m3", sender: "you", text: "<p>on it</p>", mentions: [], mentions_usernames: [], deleted: null },
      ];
      const answers: Record<string, unknown> = {
        message_position: messages.findIndex((m) => m.id === args.message_id),
        get_messages_from: { messages: messages.slice(Number(args.start), Number(args.start) + 1) },
        get_info: { name: "launch", context_type: "Channel" },
        get_member_role: "Mod",
        get_poll: { can_vote: true, definition: { title: "Offsite location", options: ["Lisbon", "Berlin", "Remote"] } },
      };
      if (!(method in answers)) throw new Error(`the demo app has no ${method}`);
      return answers[method] as T;
    },
  };
  const events: Record<string, { kind: string; payload: unknown; contextId: string }[]> = {
    chat: [
      { kind: "MessageSent", payload: { message_id: "m3" }, contextId: "demo-chat" },
      { kind: "ReactionUpdated", payload: "m1", contextId: "demo-chat" },
      { kind: "MessageSent", payload: { message_id: "m2" }, contextId: "demo-chat" },
      { kind: "MessageSent", payload: { message_id: "m1" }, contextId: "demo-chat" },
    ],
    vote: [
      { kind: "BallotCast", payload: { poll_id: "p1", voter: "priya" }, contextId: "demo-vote" },
      { kind: "VotingOpened", payload: { poll_id: "p1" }, contextId: "demo-vote" },
    ],
  };
  return (lens) => preview(lens, events[lens.app] ?? [], () => host);
}
