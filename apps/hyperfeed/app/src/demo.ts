import type {
  ActionInput,
  AppCount,
  Ask,
  Attachment,
  FeedItem,
  FeedPage,
  LensView,
  NotificationInput,
  PolicyView,
  SettingsView,
  Step,
  Verdict,
} from "./generated/HyperfeedClient";
import { PAGE_SIZE, type AgentMode, type Decision, type FeedBackend, type Filter, type NotificationMode } from "./backend";
import { MAX_ATTACHMENTS, refuseImage, type BlobStore } from "./attachments";
import chatLens from "./lens/fixtures/chat.json";
import voteLens from "./lens/fixtures/vote.json";

/**
 * The Hyperfeed contract's rules, in memory, so the app can be tried without a
 * node. It answers every call the way `logic/src/lib.rs` does — the same
 * verdicts, status transitions, chains, asks and refusals — and `demo.test.ts`
 * holds it to the cases the contract's own tests assert.
 *
 * It also plays the agent: an approval, a retry, an undo or an answer is
 * carried out a moment later, the way a real agent watching the feed would
 * report back with `complete_action` or `complete_answer`.
 */

const GUARDS: [string, boolean][] = [
  ["sign", true],
  ["money", true],
  ["new_contact", true],
  ["delete", true],
  ["invite", false],
  ["secret", false],
];

export const NO_ASK: Ask = { kind: "", prompt: "", options: [], draft: "" };

/** The contract's limits on a message and on a title. */
const MAX_MESSAGE = 2_000;
const MAX_TITLE = 200;

/** A message's first line, cut to a title's length (the contract's `headline`). */
export function headline(text: string): string {
  const line = (text.split("\n")[0] ?? "").trim();
  return line.length <= MAX_TITLE ? line : `${line.slice(0, MAX_TITLE - 1)}…`;
}

type Listener = () => void;

const MINUTE = 60_000;

export class DemoBackend implements FeedBackend {
  readonly kind = "demo" as const;
  private items = new Map<string, FeedItem>();
  /** Notifications' "flagged" bit, which `needs_you` is derived from. */
  private flagged = new Map<string, boolean>();
  /** Breaches you have not kept yet (an item's `breach` is what is shown). */
  private breaches = new Map<string, string>();
  private policies = new Map<string, PolicyView>();
  private guards = new Map<string, boolean>();
  private paused = false;
  /** Chains put away: the chain's latest activity then, and when "later" brings it back (0: never). */
  private archivedChains = new Map<string, { at: number; until: number }>();
  private lensRows = new Map<string, LensView>();
  /** What the feed sent into other apps, newest last: the demo's stand-in for them. */
  readonly sent: { contextId: string; method: string; args: Record<string, unknown> }[] = [];
  private listeners = new Set<Listener>();
  private nextId = 1;
  private clock = 0;

  constructor(
    seed = true,
    /** How long the pretend agent takes to carry out a decision. 0 = never. */
    private readonly agentDelayMs = 1_400,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (seed) this.seed();
    if (seed) this.seedLenses();
  }

  /** Called whenever the feed changes, as a node's event stream would. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    for (const l of this.listeners) l();
  }

  /** Strictly increasing, like the contract's `next_at`. */
  private tick(at = this.now()): number {
    this.clock = Math.max(this.clock + 1, at);
    return this.clock;
  }

  // ── rules (mirrors `Hyperfeed::verdict`) ──────────────────────────────────

  private policy(app: string): PolicyView {
    return this.policies.get(app) ?? { app, agent: "ask", notifications: "feed" };
  }

  private guardOn(category: string): boolean {
    if (!category) return false;
    return this.guards.get(category) ?? GUARDS.find(([name]) => name === category)?.[1] ?? false;
  }

  verdict(app: string, category: string, writes: boolean): Verdict {
    const mode = this.policy(app).agent;
    const answer = (decision: string, reason: string): Verdict => ({ decision, reason });
    if (mode === "off") return answer("refuse", `your agent is off in ${app}`);
    if (!writes) return answer("act", `reading in ${app} is allowed`);
    if (mode === "read") return answer("refuse", `your agent may only read in ${app}`);
    if (this.paused) return answer("ask", "your agent is paused");
    if (this.guardOn(category)) return answer("ask", `"${category}" always needs you`);
    if (mode === "ask") return answer("ask", `your agent asks first in ${app}`);
    return answer("act", `your agent may act in ${app}`);
  }

  private needsYou(item: FeedItem): boolean {
    // In a conversation, only your agent's open question needs you.
    if (item.kind === "message") return item.from === "agent" && item.status === "asked";
    if (item.kind === "notification") {
      if (item.ask.kind) return item.status === "received" || item.status === "failed";
      return (this.flagged.get(item.id) ?? false) && !item.seen;
    }
    return item.status === "pending" || item.status === "failed" || item.breach !== "";
  }

  /** Store a row, deriving what the contract derives from its history. */
  private put(item: FeedItem): FeedItem {
    const last = item.history[item.history.length - 1]!;
    const stored: FeedItem = {
      ...item,
      breach: this.breaches.get(item.id) ?? "",
      status: last.status,
      status_at: last.at,
      note: last.note,
      chain_len: 1,
      chain_at: last.at,
    };
    stored.needs_you = this.needsYou(stored);
    // A step shows only while the message is being worked on.
    if (stored.kind === "message" && stored.status !== "thinking") {
      stored.doing = "";
      stored.doing_at = 0;
    }
    this.items.set(stored.id, stored);
    return copy(stored);
  }

  private get(id: string, kind: FeedItem["kind"]): FeedItem {
    const item = this.items.get(id);
    if (!item || item.kind !== kind) throw new Error(`no ${kind} ${id}`);
    return item;
  }

  private step(item: FeedItem, status: string, note = ""): FeedItem {
    const at = this.tick();
    return this.put({ ...item, history: [...item.history, { status, note, at }] });
  }

  private static checkAnswer(ask: Ask, answer: string): string {
    switch (ask.kind) {
      case "choose":
        if (!ask.options.includes(answer)) throw new Error(`answer must be one of ${ask.options.join(", ")}`);
        return answer;
      case "reply":
        if (!answer.trim()) throw new Error("answer must not be empty");
        return answer;
      default:
        if (answer) throw new Error("this takes no answer");
        return "";
    }
  }

  // ── FeedBackend ────────────────────────────────────────────────────────────

  private visible(includeMuted: boolean): FeedItem[] {
    const muted = new Set([...this.policies.values()].filter((p) => p.notifications === "mute").map((p) => p.app));
    return [...this.items.values()].filter((i) => includeMuted || i.kind === "action" || !muted.has(i.app));
  }

  async feed(filter: Filter, appKey: string): Promise<FeedPage> {
    const chains = new Map<string, FeedItem[]>();
    for (const i of this.visible(false)) chains.set(i.chain, [...(chains.get(i.chain) ?? []), i]);

    const counts = { all: 0, agent: 0, notifications: 0, needs_you: 0, archived: 0 };
    const apps = new Map<string, number>();
    const rows: { lead: FeedItem; action: boolean; notification: boolean; apps: Set<string> }[] = [];
    for (const items of chains.values()) {
      const byTime = (a: FeedItem, b: FeedItem) => a.at - b.at || (a.id < b.id ? -1 : 1);
      const sorted = [...items].sort(byTime);
      const needing = sorted.filter((i) => i.needs_you);
      const lead = copy(needing[needing.length - 1] ?? sorted[sorted.length - 1]!);
      lead.chain_len = items.length;
      lead.chain_at = Math.max(...items.map((i) => i.chain_at));
      lead.needs_you = needing.length > 0;
      const chainApps = new Set(items.map((i) => i.app).filter(Boolean));
      // A conversation with your agent counts as agent activity.
      const action = items.some((i) => i.kind === "action" || i.kind === "message");
      const notification = items.some((i) => i.kind === "notification");
      const put = this.archivedChains.get(lead.chain);
      const archived = Boolean(put && lead.chain_at <= put.at && (put.until === 0 || this.now() < put.until));
      counts.archived += archived ? 1 : 0;
      if (archived !== (filter === "archived")) continue;
      if (archived) {
        rows.push({ lead, action, notification, apps: chainApps });
        continue;
      }
      counts.all += 1;
      counts.agent += action ? 1 : 0;
      counts.notifications += notification ? 1 : 0;
      counts.needs_you += lead.needs_you ? 1 : 0;
      for (const a of chainApps) apps.set(a, (apps.get(a) ?? 0) + 1);
      rows.push({ lead, action, notification, apps: chainApps });
    }
    const items = rows
      .filter((r) =>
        filter === "agent" ? r.action : filter === "notifications" ? r.notification : filter === "needs_you" ? r.lead.needs_you : true,
      )
      .filter((r) => !appKey || r.apps.has(appKey))
      .map((r) => r.lead)
      .sort((a, b) => b.chain_at - a.chain_at || (b.chain < a.chain ? -1 : 1));
    const appCounts: AppCount[] = [...apps.entries()]
      .map(([app, count]) => ({ app, count }))
      .sort((a, b) => b.count - a.count || a.app.localeCompare(b.app));
    return {
      items: items.slice(0, PAGE_SIZE),
      counts,
      apps: appCounts,
      next_before: items.length > PAGE_SIZE ? (items[PAGE_SIZE - 1]?.chain_at ?? 0) : 0,
    };
  }

  async chain(chain: string): Promise<FeedItem[]> {
    const items = this.visible(true)
      .filter((i) => i.chain === chain)
      .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
      .map(copy);
    const chainAt = Math.max(0, ...items.map((i) => i.chain_at));
    for (const i of items) {
      i.chain_len = items.length;
      i.chain_at = chainAt;
    }
    return items;
  }

  async settings(): Promise<SettingsView> {
    return {
      owner: "demo-account",
      paused: this.paused,
      policies: [...this.policies.values()].sort((a, b) => a.app.localeCompare(b.app)),
      guards: GUARDS.map(([category]) => ({ category, enabled: this.guardOn(category) })),
      // The pretend agent is "there" whenever it answers.
      agents: this.agentDelayMs > 0 ? [{ name: "demo agent", seen_at: this.now() }] : [],
    };
  }

  async archive(chains: string[], until = 0): Promise<number> {
    if (until !== 0 && until <= this.now()) throw new Error("until must be in the future, or 0");
    for (const chain of chains) {
      const rows = [...this.items.values()].filter((i) => i.chain === chain);
      if (rows.length === 0) throw new Error(`no chain ${chain}`);
      this.archivedChains.set(chain, { at: Math.max(...rows.map((i) => Math.max(i.chain_at, i.at))), until });
    }
    this.changed();
    return chains.length;
  }

  async unarchive(chains: string[]): Promise<number> {
    for (const chain of chains) this.archivedChains.delete(chain);
    this.changed();
    return chains.length;
  }

  async resolveAction(id: string, decision: Decision, answer = ""): Promise<FeedItem> {
    const item = this.get(id, "action");
    if (decision === "keep") {
      if (!item.breach) throw new Error(`action ${id} has nothing to keep`);
      if (answer) throw new Error("keep takes no answer");
      this.breaches.delete(id);
      const kept = this.put({ ...item, reviewed_at: this.tick() });
      this.changed();
      return kept;
    }
    let note = "";
    if (item.status === "pending" && decision === "approve") note = DemoBackend.checkAnswer(item.ask, answer);
    else if (answer) throw new Error(`${decision} takes no answer`);
    const next =
      item.status === "pending" && decision === "approve"
        ? "approved"
        : item.status === "failed" && decision === "approve"
          ? "retrying"
          : (item.status === "pending" || item.status === "failed") && decision === "decline"
            ? "declined"
            : item.status === "done" && decision === "undo"
              ? item.undoable
                ? "undo_requested"
                : null
              : null;
    if (!next) throw new Error(`cannot ${decision} an action that is ${item.status}`);
    const reviewedAt = item.breach ? this.tick() : item.reviewed_at;
    this.breaches.delete(id);
    const updated = this.step({ ...item, reviewed_at: reviewedAt }, next, note);
    this.changed();
    if (this.agentDelayMs > 0 && next !== "declined") setTimeout(() => this.agentCompletes(id), this.agentDelayMs);
    return updated;
  }

  async answerNotification(id: string, answer: string): Promise<FeedItem> {
    const item = this.get(id, "notification");
    if (!item.ask.kind) throw new Error(`notification ${id} has nothing to answer; open it in its app`);
    if (item.status !== "received" && item.status !== "failed") throw new Error(`notification ${id} is already ${item.status}`);
    const note = DemoBackend.checkAnswer(item.ask, answer);
    const answered = this.step({ ...item, seen: true }, "answered", note);
    this.changed();
    // A typed row with a reply call is carried out by the feed itself.
    if (this.agentDelayMs > 0 && !item.reply_call) setTimeout(() => this.agentDelivers(id), this.agentDelayMs);
    return answered;
  }

  /** What the pretend agent reports after you decide on an action. */
  private agentCompletes(id: string) {
    const item = this.items.get(id);
    if (!item) return;
    const decided = item.note;
    const outcome: Record<string, [string, string]> = {
      approved: ["done", decided ? `Done: ${decided}` : "Carried out by your agent."],
      retrying: ["done", "Retried after you granted access."],
      undo_requested: ["undone", "Your agent reverted it."],
    };
    const next = outcome[item.status];
    if (!next) return;
    this.step(item, next[0], next[1]);
    this.changed();
  }

  async completeAnswer(id: string, outcome: "delivered" | "failed", note: string): Promise<FeedItem> {
    const item = this.get(id, "notification");
    if (item.status !== "answered") throw new Error(`notification ${id} is ${item.status}; nothing is waiting on the agent`);
    const done = this.step(item, outcome, note);
    this.changed();
    return done;
  }

  /** The other app, as far as the demo goes: it takes the call. */
  async callApp(contextId: string, method: string, args: Record<string, unknown>): Promise<unknown> {
    this.sent.push({ contextId, method, args });
    return null;
  }

  async lenses(): Promise<LensView[]> {
    return [...this.lensRows.values()].sort((a, b) => b.updated_at - a.updated_at).map((l) => ({ ...l }));
  }

  async decideLens(appKey: string, applicationId: string, decision: "approve" | "reject"): Promise<LensView> {
    const key = `${appKey}@${applicationId}`;
    const lens = this.lensRows.get(key);
    if (!lens) throw new Error(`no lens for ${appKey} at ${applicationId}`);
    const next = { ...lens, status: decision === "approve" ? "approved" : "rejected", updated_at: this.tick() };
    this.lensRows.set(key, next);
    this.changed();
    return { ...next };
  }

  /** What the pretend agent learned: Chat in use, Vote waiting for you. */
  private seedLenses() {
    const at = this.now();
    this.lensRows.set("chat@demo-chat", {
      app: "chat",
      application_id: "demo-chat",
      spec: JSON.stringify(chatLens),
      summary: "DMs, mentions of you or of everyone, and your role changing; answers with send_message.",
      status: "approved",
      updated_at: at - 3 * 60 * MINUTE,
    });
    this.lensRows.set("vote@demo-vote", {
      app: "vote",
      application_id: "demo-vote",
      spec: JSON.stringify(voteLens),
      summary: "Polls you can vote in, as they open. Ballots are sealed: you vote in the Vote app.",
      status: "proposed",
      updated_at: at - 5 * MINUTE,
    });
  }

  /** What the pretend agent reports after you answer a notification. */
  private agentDelivers(id: string) {
    const item = this.items.get(id);
    if (!item || item.status !== "answered") return;
    const where = item.source_label ? ` in ${item.source_label}` : "";
    const note = item.ask.kind === "reply" ? `Sent${where}` : item.ask.kind === "choose" ? `Answered "${item.note}"${where}` : `Done${where}`;
    this.step(item, "delivered", note);
    this.changed();
  }

  /** Images live in memory: the demo has no node to keep blobs on. */
  readonly images: BlobStore = {
    upload: async (data) => {
      const blobId = fakeHash(this.nextId++);
      this.blobs.set(blobId, data);
      return { blobId, size: data.size };
    },
    read: async (blobId) => {
      const blob = this.blobs.get(blobId);
      if (!blob) throw new Error(`no blob ${blobId}`);
      return blob;
    },
  };
  private blobs = new Map<string, Blob>();

  async say(chain: string, text: string, attachments: Attachment[] = []): Promise<FeedItem> {
    if (!text.trim() && attachments.length === 0) throw new Error("text must not be empty");
    if (new TextEncoder().encode(text).length > MAX_MESSAGE) throw new Error(`text is longer than ${MAX_MESSAGE} bytes`);
    if (attachments.length > MAX_ATTACHMENTS) throw new Error(`${attachments.length} attachments, limit is ${MAX_ATTACHMENTS}`);
    for (const a of attachments) {
      const refused = refuseImage({ name: a.name, type: a.mime, size: a.size }, 0);
      if (refused) throw new Error(refused);
    }
    if (chain && !this.chainExists(chain)) throw new Error(`no chain ${chain}`);
    // Whatever your agent asked you in this chain, your words answer.
    for (const m of [...this.items.values()]) {
      if (chain && m.chain === chain && m.kind === "message" && m.from === "agent" && m.status === "asked") this.step(m, "answered", text.slice(0, 250));
    }
    const posted = this.post(chain, "you", text, "", "waiting", NO_ASK, attachments);
    this.changed();
    if (this.agentDelayMs > 0) {
      setTimeout(() => this.agentAck(posted.id), this.agentDelayMs / 2);
      setTimeout(() => this.agentAnswers(posted.id), this.agentDelayMs * 2);
    }
    return posted;
  }

  /** The agent's side of a conversation, as `agent_ack` would take it. */
  agentAck(id: string, status: "thinking" | "failed" = "thinking", note = ""): FeedItem {
    const m = this.get(id, "message");
    if (m.from !== "you") throw new Error(`message ${id} is the agent's own`);
    if (!(m.status === "waiting" || (m.status === "thinking" && status === "failed"))) {
      throw new Error(`message ${id} is ${m.status}; cannot mark it ${status}`);
    }
    const item = this.step(m, status, note);
    this.changed();
    return item;
  }

  /** What the agent is doing on a message it took up, as `agent_progress` would take it. */
  agentProgress(id: string, doing: string): FeedItem {
    const m = this.get(id, "message");
    if (m.from !== "you") throw new Error(`message ${id} is the agent's own`);
    if (m.status !== "thinking") throw new Error(`message ${id} is ${m.status}; progress is for a message being worked on`);
    if (!doing.trim()) throw new Error("doing must not be empty");
    const stored = this.items.get(id)!;
    stored.doing = doing;
    stored.doing_at = Math.max(this.now(), stored.doing_at + 1);
    this.changed();
    return copy(stored);
  }

  /** The agent's side of a conversation, as `agent_say` would take it. */
  agentSay(chain: string, replyTo: string, text: string, ask?: Ask): FeedItem {
    if (!text.trim()) throw new Error("text must not be empty");
    if (ask && ask.kind !== "reply" && ask.kind !== "choose") throw new Error("ask.kind must be one of reply, choose");
    if (ask?.kind === "choose" && ask.options.length < 2) throw new Error("a choose ask needs at least 2 options");
    if (!replyTo) {
      if (!this.chainExists(chain)) throw new Error(`no chain ${chain}`);
    } else {
      const asked = this.get(replyTo, "message");
      if (asked.from !== "you") throw new Error(`message ${replyTo} is the agent's own; answer one of yours`);
      if (asked.chain !== chain) throw new Error(`message ${replyTo} is in chain ${asked.chain}, not ${chain}`);
      if (asked.status !== "answered") this.step(asked, "answered");
    }
    const said = this.post(chain, "agent", text, replyTo, ask ? "asked" : "said", ask);
    this.changed();
    return said;
  }

  /** The agent asks you something back, as `agent_ask` would take it. */
  agentAsk(chain: string, replyTo: string, text: string, ask: Ask): FeedItem {
    return this.agentSay(chain, replyTo, text, ask);
  }

  private chainExists(chain: string): boolean {
    return [...this.items.values()].some((i) => i.chain === chain);
  }

  private post(
    chain: string,
    from: "you" | "agent",
    text: string,
    replyTo: string,
    status: string,
    ask: Ask = NO_ASK,
    attachments: Attachment[] = [],
  ): FeedItem {
    const id = `demo-${this.nextId++}`;
    const t = this.tick();
    const images = attachments.length;
    return this.put({
      ...blank(id, "message", "", t, chain || id, ask),
      title: text || images === 0 ? headline(text) : images === 1 ? "Sent an image" : `Sent ${images} images`,
      body: text,
      from,
      reply_to: replyTo,
      history: [{ status, note: "", at: t }],
      attachments: attachments.map((a) => ({ ...a })),
    });
  }

  /**
   * The pretend agent's answer. It can only say where things stand: there is
   * no agent behind the demo to go and do anything.
   */
  private agentAnswers(id: string) {
    const asked = this.items.get(id);
    if (!asked || asked.status === "answered" || asked.status === "failed") return;
    const about = [...this.items.values()]
      .filter((i) => i.chain === asked.chain && i.kind !== "message")
      .sort((a, b) => b.at - a.at)[0];
    const text = about
      ? `On "${about.title}": it is ${about.status.replace("_", " ")}. I'm the demo's pretend agent, so this is as far as I go. ` +
        "Connect your node and your own agent answers here, and proposes or acts in this chain under your rules."
      : "I'm the demo's pretend agent, so I can't take that on. Connect your node and your own agent answers here, " +
        "and proposes or acts under your rules.";
    this.agentSay(asked.chain, id, text);
  }

  async markSeen(ids: string[]): Promise<number> {
    let count = 0;
    for (const id of ids) {
      const item = this.items.get(id);
      if (!item || item.kind !== "notification" || item.seen) continue;
      this.put({ ...item, seen: true, status_at: this.tick() });
      count += 1;
    }
    if (count) this.changed();
    return count;
  }

  async markAllSeen(): Promise<number> {
    return this.markSeen([...this.items.values()].filter((i) => i.kind === "notification").map((i) => i.id));
  }

  async setPolicy(appKey: string, agent: AgentMode, notifications: NotificationMode): Promise<PolicyView> {
    const policy = { app: appKey, agent, notifications };
    this.policies.set(appKey, policy);
    this.changed();
    return { ...policy };
  }

  async setGuard(category: string, enabled: boolean): Promise<void> {
    if (!GUARDS.some(([name]) => name === category)) throw new Error(`unknown guard ${category}`);
    this.guards.set(category, enabled);
    this.changed();
  }

  async setPaused(paused: boolean): Promise<void> {
    this.paused = paused;
    this.changed();
  }

  async recordNotification(input: NotificationInput, at = this.now()): Promise<FeedItem> {
    const existing = this.items.get(input.key);
    if (existing) return copy(existing);
    // Older callers leave the typed parts out, as the contract allows.
    input = { ...input, item_type: input.item_type ?? "", fields: input.fields ?? "", reply_call: input.reply_call ?? "" };
    if (!["", "message", "assignment", "poll", "invite", "turn", "request", "change", "status", "other"].includes(input.item_type)) {
      throw new Error(`item_type must be one of the feed's types, not ${input.item_type}`);
    }
    const t = this.tick(at);
    this.flagged.set(input.key, input.needs_you);
    const item = this.put({
      ...blank(input.key, "notification", input.app, t, input.chain || input.key, input.ask),
      source_context: input.source_context,
      source_label: input.source_label,
      title: input.title,
      body: input.body,
      from: input.from,
      event: input.event,
      item_type: input.item_type,
      fields: input.fields,
      reply_call: input.reply_call,
      seen: false,
      history: [{ status: "received", note: "", at: t }],
    });
    this.changed();
    return item;
  }

  async recordAction(input: ActionInput, at = this.now()): Promise<FeedItem> {
    if (input.ask.kind && input.outcome !== "proposed") {
      throw new Error("an ask belongs on a proposal; a done or failed action has nothing to answer");
    }
    const verdict = this.verdict(input.app, input.category, input.writes);
    let status: string;
    let breach = "";
    if (input.outcome === "proposed") {
      if (verdict.decision === "refuse") throw new Error(`not allowed: ${verdict.reason}`);
      status = "pending";
    } else {
      status = input.outcome === "failed" ? "failed" : "done";
      if (verdict.decision === "ask") breach = `acted without asking: ${verdict.reason}`;
      if (verdict.decision === "refuse") breach = `acted where it may not: ${verdict.reason}`;
    }
    const id = `demo-${this.nextId++}`;
    if (breach) this.breaches.set(id, breach);
    const t = this.tick(at);
    const item = this.put({
      ...blank(id, "action", input.app, t, input.chain || id, input.ask),
      source_context: input.source_context,
      source_label: input.source_label,
      title: input.title,
      body: input.body,
      method: input.method,
      category: input.category,
      why: input.why,
      intent_hash: input.intent_hash,
      executor: input.executor,
      undoable: input.undoable,
      history: [{ status, note: input.note, at: t }],
    });
    this.changed();
    return item;
  }

  // ── seed: the morning the design shows ────────────────────────────────────

  private seed() {
    const now = this.now();
    const ago = (minutes: number) => now - minutes * MINUTE;
    for (const [app, agent, n] of [
      ["chat", "act", "push"],
      ["calendar", "ask", "feed"],
      ["sheets", "act", "feed"],
      ["issues", "act", "push"],
      ["docs", "ask", "feed"],
      ["crm", "act", "feed"],
      ["sign", "ask", "push"],
      ["pass", "read", "feed"],
      ["updates", "read", "feed"],
      ["vote", "off", "feed"],
    ] as const) {
      this.policies.set(app, { app, agent, notifications: n });
    }
    const exec = { intent_hash: fakeHash(1), executor: "relay · tee-eu-3" };
    const done = (minutes: number, input: Partial<ActionInput>) =>
      void this.recordAction(action({ outcome: "done", ...exec, ...input }), ago(minutes));
    const note = (minutes: number, input: Partial<NotificationInput> & { key: string }) =>
      void this.recordNotification(notification(input), ago(minutes));

    // The stand-up: a chain of one.
    done(105, {
      app: "chat",
      source_label: "#eng-standup",
      method: "send_message",
      undoable: true,
      title: "Posted your stand-up",
      body: "Yesterday: shipped feed grouping. Today: HF-31 and the reconnect bug. Blockers: none.",
      why: "Daily routine you set up, drafted from yesterday's closed issues.",
    });

    // Northwind: a failed CRM update, then a reply the agent drafted for you.
    void this.recordAction(
      action({
        app: "crm",
        source_label: "Acme · Sales",
        method: "update_deal",
        title: 'Couldn\'t move deal "Northwind" to Negotiation',
        why: "Jordan at Northwind asked for the contract terms.",
        outcome: "failed",
        note: "No write grant in the Sales group yet.",
        chain: "northwind",
        ...exec,
      }),
      ago(93),
    );
    void this.recordAction(
      action({
        app: "chat",
        source_label: "DM · Jordan Lee",
        method: "send_message",
        undoable: true,
        title: "Reply to Jordan with the contract terms",
        why: "Jordan asked for terms; I drafted a reply from the deal notes.",
        outcome: "proposed",
        chain: "northwind",
        ask: {
          kind: "reply",
          prompt: "Send to Jordan",
          options: [],
          draft: "Hi Jordan, terms are attached: 12 months, net 30, annual billing. Happy to talk through them Thursday.",
        },
      }),
      ago(90),
    );

    // The issue tracker assigns you something; you decide in place.
    note(64, {
      key: "issues-ctx:a>b:0",
      app: "issues",
      source_label: "Hyperfeed",
      from: "Tomás Reid",
      title: "Assigned HF-31 to you",
      body: "Notification grouping drops events when two apps emit in the same block.",
      event: "IssueAssigned",
      needs_you: true,
      ask: { kind: "choose", prompt: "Take it?", options: ["Take it this sprint", "Next sprint", "Hand back to Tomás"], draft: "" },
      item_type: "assignment",
      fields: JSON.stringify({ from: "Tomás Reid", what: "HF-31", detail: "Notification grouping drops events when two apps emit in the same block.", due: "This sprint" }),
    });

    // A calendar invite, answered straight into Calendar.
    note(20, {
      key: "cal-ctx:g>h:0",
      app: "calendar",
      source_label: "Design team",
      from: "Maya Ortiz",
      title: "Invited you to Q3 planning",
      body: "",
      event: "CalendarEventCreated",
      needs_you: true,
      ask: { kind: "choose", prompt: "Going?", options: ["Accept", "Decline"], draft: "" },
      item_type: "invite",
      fields: JSON.stringify({ from: "Maya Ortiz", what: "Q3 planning", when: "Thu 10:00–11:00", where: "Design team" }),
      reply_call: JSON.stringify({ method: "respond", args: { event_id: "evt-q3", answer: "=answer" } }),
    });

    // The agent commented without asking: a breach to keep or undo.
    done(52, {
      app: "docs",
      source_label: "Pricing v4",
      method: "add_comment",
      undoable: true,
      title: 'Left 6 comments on "Pricing v4"',
      body: "Flagged two numbers that disagree with the Metrics sheet.",
      why: "You asked for a review before the pricing call.",
    });

    // A poll you vote in from the feed.
    note(40, {
      key: "vote-ctx:c>d:0",
      app: "vote",
      source_label: "Team offsite",
      from: "Priya Nair",
      title: 'Vote: "Offsite location"',
      body: "",
      event: "PollCreated",
      ask: { kind: "choose", prompt: "Your vote", options: ["Lisbon", "Berlin", "Remote"], draft: "" },
      item_type: "poll",
      fields: JSON.stringify({ from: "Priya Nair", question: "Offsite location", options: ["Lisbon", "Berlin", "Remote"], closes_at: "Tomorrow 18:00" }),
    });

    // #launch: Maya's mention starts a chain the agent works through.
    note(6, {
      key: "chat-launch:e>f:0",
      app: "chat",
      source_label: "#launch",
      from: "Maya Ortiz",
      title: "Mentioned you",
      body: "Can your agent pull last week's numbers into the board deck before 2? And we need the Northwind NDA out today.",
      event: "MessageSent",
      needs_you: true,
      ask: { kind: "reply", prompt: "Reply in #launch", options: ["On it", "After 2pm", "Can you send the deck link?"], draft: "" },
      // Typed by the Chat lens: your reply goes straight into #launch.
      item_type: "message",
      fields: JSON.stringify({ from: "Maya Ortiz", from_id: "maya", text: "Can your agent pull last week's numbers…", where: "#launch", is_dm: false }),
      reply_call: JSON.stringify({"method": "send_message", "args": {"message": "=answer", "mentions": [], "mentions_usernames": [], "parent_message": null, "timestamp": "=now_s()", "files": null, "images": null}}),
    });
    done(4, {
      app: "sheets",
      source_label: "Q3 board deck",
      method: "set_cells",
      undoable: true,
      title: 'Pulled 4 KPIs into "Q3 board deck"',
      body: "Revenue, active teams, churn and NPS for last week, with source cells linked.",
      why: "Maya asked for last week's numbers before 2.",
      chain: "chat-launch:e>f:0",
    });
    void this.recordAction(
      action({
        app: "calendar",
        source_label: "Design team",
        method: "create_event",
        undoable: true,
        title: "Book 20 minutes with Maya to go through the numbers",
        why: "The board deck is due at 2; both of you are free at these times.",
        outcome: "proposed",
        chain: "chat-launch:e>f:0",
        ask: { kind: "choose", prompt: "Pick a slot", options: ["Today 12:30", "Today 13:15", "Tomorrow 09:30"], draft: "" },
      }),
      ago(2),
    );
    void this.recordAction(
      action({
        app: "sign",
        source_label: "Acme · Legal",
        method: "request_signature",
        category: "sign",
        title: 'Prepared "Vendor NDA — Northwind" for your signature',
        body: "Two fields were filled from the CRM deal.",
        why: "Maya asked to get the NDA out today. Signatures always need your approval.",
        outcome: "proposed",
        chain: "chat-launch:e>f:0",
      }),
      ago(1),
    );
  }

  /** The "simulate" button: what an agent might do next, recorded through the rules. */
  async simulateAgent(): Promise<FeedItem> {
    const ideas: Partial<ActionInput>[] = [
      { app: "chat", source_label: "#launch", method: "send_message", title: "Shared the deck link in #launch", undoable: true, chain: "chat-launch:e>f:0" },
      { app: "calendar", source_label: "Design team", method: "create_event", title: "Booked a focus block · Fri 10:00", undoable: true },
      { app: "crm", source_label: "Acme · Sales", method: "add_contact", title: "Added Jordan Lee (Northwind) as a contact", category: "new_contact", chain: "northwind" },
      { app: "docs", source_label: "Pricing v4", method: "delete_comment", title: "Removed a stale comment on Pricing v4", category: "delete" },
    ];
    const idea = ideas[(this.nextId - 1) % ideas.length] ?? ideas[0]!;
    const verdict = this.verdict(idea.app ?? "chat", idea.category ?? "", true);
    // A well-behaved agent asks when the rules say ask, and acts otherwise.
    return this.recordAction(
      action({ ...idea, why: "Simulated: what your agent might do next.", outcome: verdict.decision === "act" ? "done" : "proposed" }),
    );
  }
}

function action(input: Partial<ActionInput>): ActionInput {
  return {
    app: "chat",
    source_context: `${input.app ?? "chat"}-context`,
    source_label: "",
    method: "",
    category: "",
    writes: true,
    undoable: false,
    title: "",
    body: "",
    why: "",
    outcome: "done",
    intent_hash: "",
    executor: "",
    note: "",
    chain: "",
    ask: NO_ASK,
    ...input,
  };
}

function notification(input: Partial<NotificationInput> & { key: string }): NotificationInput {
  return {
    app: "chat",
    source_context: `${input.app ?? "chat"}-context`,
    source_label: "",
    from: "",
    title: "",
    body: "",
    event: "",
    needs_you: false,
    chain: "",
    ask: NO_ASK,
    item_type: "",
    fields: "",
    reply_call: "",
    ...input,
  };
}

function fakeHash(n: number): string {
  let h = 2166136261 ^ n;
  let out = "";
  for (let i = 0; i < 16; i++) {
    h = Math.imul(h ^ (h >>> 13), 16777619) >>> 0;
    out += (h & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}

function copy(item: FeedItem): FeedItem {
  return {
    ...item,
    ask: { ...item.ask, options: [...item.ask.options] },
    history: item.history.map((s: Step) => ({ ...s })),
    attachments: item.attachments.map((a) => ({ ...a })),
  };
}

function blank(id: string, kind: FeedItem["kind"], app: string, at: number, chain: string, ask: Ask): FeedItem {
  return {
    id,
    kind,
    chain,
    chain_len: 1,
    chain_at: at,
    app,
    source_context: "",
    source_label: "",
    title: "",
    body: "",
    at,
    needs_you: false,
    status: "",
    status_at: at,
    note: "",
    ask,
    history: [],
    method: "",
    category: "",
    why: "",
    intent_hash: "",
    executor: "",
    undoable: false,
    breach: "",
    reviewed_at: 0,
    from: "",
    event: "",
    seen: kind !== "notification",
    reply_to: "",
    item_type: "",
    fields: "",
    reply_call: "",
    doing: "",
    doing_at: 0,
    attachments: [],
  };
}
