import type {
  ActionInput,
  AppCount,
  FeedItem,
  FeedPage,
  NotificationInput,
  PolicyView,
  SettingsView,
  Verdict,
} from "./generated/HyperfeedClient";
import { PAGE_SIZE, type AgentMode, type Decision, type FeedBackend, type Filter, type NotificationMode } from "./backend";

/**
 * The Hyperfeed contract's rules, in memory, so the app can be tried without a
 * node. It answers every call the way `logic/src/lib.rs` does — the same
 * verdicts, the same status transitions, the same refusals — and `demo.test.ts`
 * holds it to the cases the contract's own tests assert.
 *
 * It also plays the agent: an approval, a retry or an undo is "carried out" a
 * moment later, the way a real agent watching the feed would report back with
 * `complete_action`.
 */

const GUARDS: [string, boolean][] = [
  ["sign", true],
  ["money", true],
  ["new_contact", true],
  ["delete", true],
  ["invite", false],
  ["secret", false],
];

type Listener = () => void;

const MINUTE = 60_000;

export class DemoBackend implements FeedBackend {
  readonly kind = "demo" as const;
  private items = new Map<string, FeedItem>();
  private policies = new Map<string, PolicyView>();
  private guards = new Map<string, boolean>();
  private paused = false;
  private listeners = new Set<Listener>();
  private nextId = 1;

  constructor(
    seed = true,
    /** How long the pretend agent takes to carry out a decision. 0 = never. */
    private readonly agentDelayMs = 1_400,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (seed) this.seed();
  }

  /** Called whenever the feed changes, as a node's event stream would. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    for (const l of this.listeners) l();
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

  private static needsYou(item: FeedItem): boolean {
    if (item.kind === "notification") return item.needs_you && !item.seen;
    return item.status === "pending" || item.status === "failed" || item.breach !== "";
  }

  private put(item: FeedItem): FeedItem {
    const stored = { ...item, needs_you: DemoBackend.needsYou(item) };
    this.items.set(stored.id, stored);
    return { ...stored };
  }

  private get(id: string): FeedItem {
    const item = this.items.get(id);
    if (!item) throw new Error(`no action ${id}`);
    return item;
  }

  // ── FeedBackend ────────────────────────────────────────────────────────────

  async feed(filter: Filter, appKey: string): Promise<FeedPage> {
    const muted = new Set([...this.policies.values()].filter((p) => p.notifications === "mute").map((p) => p.app));
    const all = [...this.items.values()].filter((i) => i.kind === "action" || !muted.has(i.app));
    const counts = { all: 0, agent: 0, notifications: 0, needs_you: 0 };
    const apps = new Map<string, number>();
    for (const i of all) {
      counts.all += 1;
      if (i.kind === "action") counts.agent += 1;
      else counts.notifications += 1;
      if (i.needs_you) counts.needs_you += 1;
      apps.set(i.app, (apps.get(i.app) ?? 0) + 1);
    }
    const items = all
      .filter((i) =>
        filter === "agent"
          ? i.kind === "action"
          : filter === "notifications"
            ? i.kind === "notification"
            : filter === "needs_you"
              ? i.needs_you
              : true,
      )
      .filter((i) => !appKey || i.app === appKey)
      .sort((a, b) => b.at - a.at || (b.id < a.id ? -1 : 1));
    const appCounts: AppCount[] = [...apps.entries()]
      .map(([app, count]) => ({ app, count }))
      .sort((a, b) => b.count - a.count || a.app.localeCompare(b.app));
    return {
      items: items.slice(0, PAGE_SIZE).map((i) => ({ ...i })),
      counts,
      apps: appCounts,
      next_before: items.length > PAGE_SIZE ? (items[PAGE_SIZE - 1]?.at ?? 0) : 0,
    };
  }

  async settings(): Promise<SettingsView> {
    return {
      owner: "demo-account",
      paused: this.paused,
      policies: [...this.policies.values()].sort((a, b) => a.app.localeCompare(b.app)),
      guards: GUARDS.map(([category]) => ({ category, enabled: this.guardOn(category) })),
    };
  }

  async resolveAction(id: string, decision: Decision): Promise<FeedItem> {
    const item = this.get(id);
    if (item.kind !== "action") throw new Error(`no action ${id}`);
    if (decision === "keep") {
      if (!item.breach) throw new Error(`action ${id} has nothing to keep`);
      const kept = this.put({ ...item, breach: "" });
      this.changed();
      return kept;
    }
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
    const updated = this.put({ ...item, status: next, status_at: this.now(), note: "", breach: "" });
    this.changed();
    if (this.agentDelayMs > 0 && next !== "declined") {
      setTimeout(() => this.agentCompletes(id), this.agentDelayMs);
    }
    return updated;
  }

  /** What the pretend agent reports back. */
  private agentCompletes(id: string) {
    const item = this.items.get(id);
    if (!item) return;
    const done: Record<string, [string, string]> = {
      approved: ["done", "Carried out by your agent."],
      retrying: ["done", "Retried after you granted access."],
      undo_requested: ["undone", "Your agent reverted it."],
    };
    const outcome = done[item.status];
    if (!outcome) return;
    this.put({ ...item, status: outcome[0], note: outcome[1], status_at: this.now() });
    this.changed();
  }

  async markSeen(ids: string[]): Promise<number> {
    let count = 0;
    for (const id of ids) {
      const item = this.items.get(id);
      if (!item || item.kind !== "notification" || item.seen) continue;
      this.put({ ...item, seen: true, status_at: this.now() });
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

  async recordNotification(input: NotificationInput): Promise<FeedItem> {
    const existing = this.items.get(input.key);
    if (existing) return { ...existing };
    const item = this.put({
      ...blank(input.key, "notification", input.app, this.now()),
      source_context: input.source_context,
      source_label: input.source_label,
      title: input.title,
      body: input.body,
      from: input.from,
      event: input.event,
      needs_you: input.needs_you,
      seen: false,
    });
    this.changed();
    return item;
  }

  async recordAction(input: ActionInput): Promise<FeedItem> {
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
    const at = this.now();
    const item = this.put({
      ...blank(`demo-${this.nextId++}`, "action", input.app, at),
      source_context: input.source_context,
      source_label: input.source_label,
      title: input.title,
      body: input.body,
      status,
      note: input.note,
      method: input.method,
      category: input.category,
      why: input.why,
      intent_hash: input.intent_hash,
      executor: input.executor,
      undoable: input.undoable,
      breach,
    });
    this.changed();
    return item;
  }

  // ── seed: the morning the design shows ────────────────────────────────────

  private seed() {
    const now = this.now();
    this.policies.set("chat", { app: "chat", agent: "act", notifications: "push" });
    this.policies.set("calendar", { app: "calendar", agent: "act", notifications: "feed" });
    this.policies.set("sheets", { app: "sheets", agent: "act", notifications: "feed" });
    this.policies.set("issues", { app: "issues", agent: "act", notifications: "push" });
    this.policies.set("docs", { app: "docs", agent: "act", notifications: "feed" });
    this.policies.set("crm", { app: "crm", agent: "act", notifications: "feed" });
    this.policies.set("sign", { app: "sign", agent: "ask", notifications: "push" });
    this.policies.set("pass", { app: "pass", agent: "read", notifications: "feed" });
    this.policies.set("updates", { app: "updates", agent: "read", notifications: "feed" });
    this.policies.set("vote", { app: "vote", agent: "off", notifications: "feed" });

    const action = (
      ago: number,
      app: string,
      label: string,
      method: string,
      title: string,
      extra: Partial<FeedItem>,
    ) =>
      this.put({
        ...blank(`demo-${this.nextId++}`, "action", app, now - ago * MINUTE),
        source_context: `${app}-context`,
        source_label: label,
        method,
        title,
        status: "done",
        intent_hash: fakeHash(this.nextId),
        executor: "relay · tee-eu-3",
        ...extra,
      });
    const note = (ago: number, app: string, label: string, from: string, title: string, extra: Partial<FeedItem>) =>
      this.put({
        ...blank(`${app}-context:root-${this.nextId++}:0`, "notification", app, now - ago * MINUTE),
        source_context: `${app}-context`,
        source_label: label,
        from,
        title,
        ...extra,
      });

    action(26 * 60, "pass", "Engineering vault", "get_secret", 'Read secret "staging-db"', {
      category: "secret",
      body: "Read only, used once to run the migration check you asked for.",
      why: "Running the staging migration check from HF-28.",
    });
    note(25 * 60, "vote", "Team offsite", "Priya Nair", 'Poll "Offsite location" closes tomorrow', {
      body: "You haven't voted. Your agent won't vote for you.",
      event: "PollClosingSoon",
      needs_you: true,
    });
    action(22 * 60, "docs", "Pricing v4", "add_comment", 'Left 6 comments on "Pricing v4"', {
      body: "Flagged two numbers that disagree with the Metrics sheet.",
      why: "You asked for a review before the pricing call.",
      undoable: true,
    });
    note(150, "updates", "Acme investors", "Acme", 'Published "September update" with 2 asks', {
      event: "UpdatePublished",
    });
    action(105, "chat", "#eng-standup", "send_message", "Posted your stand-up", {
      body: "Yesterday: shipped feed grouping. Today: HF-31 and the reconnect bug. Blockers: none.",
      why: "Daily routine you set up. Drafted from yesterday's closed issues and your calendar.",
      undoable: true,
    });
    action(93, "crm", "Acme · Sales", "update_deal", 'Couldn\'t move deal "Northwind" to Negotiation', {
      status: "failed",
      note: "Your agent has no write grant in the Sales group yet.",
      why: "The NDA request implies the deal moved forward.",
    });
    action(75, "issues", "Hyperfeed", "create_issue", 'Filed HF-32 "Feed skips events after reconnect"', {
      body: "Steps to reproduce and logs attached from your chat with Tomás.",
      why: 'You said "file that" in your DM with Tomás.',
      undoable: true,
    });
    note(64, "issues", "Hyperfeed", "Tomás Reid", "Assigned HF-31 to you", {
      body: "Notification grouping drops events when two apps emit in the same block.",
      event: "IssueAssigned",
      needs_you: true,
    });
    action(47, "calendar", "Design team", "respond_to_invite", 'Accepted "Design review" · Thu 15:00', {
      why: "The slot was free and the organiser is on your auto-accept list.",
      undoable: true,
    });
    action(4, "sheets", "Q3 board deck", "set_cells", 'Pulled 4 KPIs into "Q3 board deck"', {
      body: "Revenue, active teams, churn and NPS for last week, with source cells linked.",
      why: "Answering Maya's mention in #launch. Read from the Metrics sheet, wrote to the deck only.",
      undoable: true,
    });
    note(3, "chat", "#launch", "Maya Ortiz", "Mentioned you", {
      body: "Can your agent pull last week's numbers into the board deck before 2?",
      event: "MessageSent",
      needs_you: true,
    });
    action(1, "sign", "Acme · Legal", "request_signature", 'Prepared "Vendor NDA — Northwind" for your signature', {
      status: "pending",
      category: "sign",
      intent_hash: "",
      executor: "",
      body: "Signing is a commitment, so it waits for you. Two fields were filled from the CRM deal.",
      why: "Maya asked in #launch to get the Northwind NDA out today. Signatures always need your approval.",
    });
  }

  /** The "simulate" button: what an agent might do next, recorded through the rules. */
  async simulateAgent(): Promise<FeedItem> {
    const ideas: ActionInput[] = [
      input("chat", "#launch", "send_message", "Replied to Maya with the deck link", false, true),
      input("calendar", "Design team", "create_event", "Booked a focus block · Fri 10:00", false, true),
      input("crm", "Acme · Sales", "add_contact", "Added Jordan Lee (Northwind) as a contact", false, true, "new_contact"),
      input("docs", "Pricing v4", "delete_comment", "Removed a stale comment on Pricing v4", false, false, "delete"),
      input("sign", "Acme · Legal", "request_signature", "Prepared the Northwind MSA for your signature", true, false, "sign"),
    ];
    const idea = ideas[(this.nextId - 1) % ideas.length] ?? ideas[0]!;
    const verdict = this.verdict(idea.app, idea.category, idea.writes);
    // A well-behaved agent asks when the rules say ask, and acts otherwise.
    return this.recordAction({ ...idea, outcome: verdict.decision === "act" ? "done" : "proposed" });
  }
}

function input(
  app: string,
  label: string,
  method: string,
  title: string,
  proposal: boolean,
  undoable: boolean,
  category = "",
): ActionInput {
  return {
    app,
    source_context: `${app}-context`,
    source_label: label,
    method,
    category,
    writes: true,
    undoable,
    title,
    body: "",
    why: "Simulated: what your agent might do next.",
    outcome: proposal ? "proposed" : "done",
    intent_hash: fakeHash(title.length),
    executor: "relay · tee-eu-3",
    note: "",
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

function blank(id: string, kind: "action" | "notification", app: string, at: number): FeedItem {
  return {
    id,
    kind,
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
    method: "",
    category: "",
    why: "",
    intent_hash: "",
    executor: "",
    undoable: false,
    breach: "",
    from: "",
    event: "",
    seen: kind === "action",
  };
}
