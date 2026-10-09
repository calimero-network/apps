import { useEffect, useId, useMemo, useState } from "react";
import type { FeedItem } from "./generated/HyperfeedClient";
import type { Filter } from "./backend";
import type { Feed } from "./useFeed";
import { pickSelected } from "./useFeed";
import { appLook } from "./apps";
import {
  choicesFor,
  fieldsOf,
  flowOf,
  groupByDay,
  resolvable,
  short,
  statusOf,
  timeLabel,
  TYPE_LABELS,
  typedFacts,
  type FlowStep,
} from "./format";

const TABS: { id: Filter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "agent", label: "Agent actions" },
  { id: "notifications", label: "Notifications" },
  { id: "needs_you", label: "Needs you" },
];

const appName = (key: string) => appLook(key).name;

export function FeedView({ feed, query }: { feed: Feed; query: string }) {
  const { page } = feed;
  const [selected, setSelected] = useState<string | null>(null);

  const items = useMemo(() => {
    const all = page?.items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((i) =>
      [i.title, i.body, i.from, i.source_label, appLook(i.app).name, i.method]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [page, query]);

  const current = pickSelected(items, selected);

  // Opening a notification is reading it.
  const { markSeen } = feed;
  useEffect(() => {
    if (current && current.kind === "notification" && !current.seen && selected === current.id) {
      void markSeen([current.id]);
    }
  }, [current, selected, markSeen]);

  const counts = page?.counts;

  return (
    <div className="layout">
      <nav className="rail" aria-label="Feed filters">
        <div className="rail-group">
          {TABS.map((t) => {
            const count =
              t.id === "all"
                ? counts?.all
                : t.id === "agent"
                  ? counts?.agent
                  : t.id === "notifications"
                    ? counts?.notifications
                    : counts?.needs_you;
            return (
              <button
                key={t.id}
                type="button"
                className={`rail-item ${feed.filter === t.id ? "active" : ""}`}
                aria-pressed={feed.filter === t.id}
                onClick={() => feed.setFilter(t.id)}
              >
                <span>{t.label}</span>
                <span className={`count ${t.id === "needs_you" ? "count-wait" : ""}`}>{count ?? 0}</span>
              </button>
            );
          })}
        </div>
        {page && page.apps.length > 0 && (
          <div className="rail-group">
            <p className="rail-heading">Apps</p>
            {page.apps.map((a) => {
              const look = appLook(a.app);
              const active = feed.appKey === a.app;
              return (
                <button
                  key={a.app}
                  type="button"
                  className={`rail-item ${active ? "active" : ""}`}
                  aria-pressed={active}
                  onClick={() => feed.setAppKey(active ? "" : a.app)}
                >
                  <Badge app={a.app} size="sm" />
                  <span className="grow">{look.name}</span>
                  <span className="muted">{a.count}</span>
                </button>
              );
            })}
          </div>
        )}
      </nav>

      <main className="stream">
        <section className="stats" aria-label="At a glance">
          <div className="stat">
            <span>Agent actions</span>
            <strong>{counts?.agent ?? "–"}</strong>
          </div>
          <div className="stat">
            <span>Notifications</span>
            <strong>{counts?.notifications ?? "–"}</strong>
          </div>
          <div className="stat stat-wait">
            <span>Waiting on you</span>
            <strong>{counts?.needs_you ?? "–"}</strong>
          </div>
        </section>

        <AskAgent feed={feed} chain="" label="Ask your agent" onPosted={(m) => setSelected(m.id)} />

        {feed.outdated && (
          <div className="notice" role="status">
            Your feed was made by an earlier Hyperfeed. It still works, but it can't hold lenses or typed items. Install the latest Hyperfeed on your node and create a new feed to get them.
          </div>
        )}

        {feed.error && (
          <div className="error" role="alert">
            <span>{feed.error}</span>
            <button type="button" className="ghost small" onClick={feed.dismissError}>
              Dismiss
            </button>
          </div>
        )}

        {page && items.length === 0 && (
          <div className="empty">
            {query ? "Nothing matches that search." : "Nothing here. Your agent and your apps are quiet."}
          </div>
        )}
        {!page && !feed.error && <div className="empty">Loading the feed…</div>}

        {groupByDay(items).map((g) => (
          <section key={g.label} className="day">
            <h2 className="day-label">{g.label}</h2>
            {g.items.map((item) => (
              <Card
                key={item.chain}
                item={item}
                feed={feed}
                selected={current?.id === item.id}
                onSelect={() => setSelected(item.id)}
              />
            ))}
          </section>
        ))}
      </main>

      <aside className="detail" aria-label="Selected item">
        {current ? (
          <Detail key={current.id} item={current} feed={feed} />
        ) : (
          <p className="muted">Pick something in the feed to see where it came from.</p>
        )}
      </aside>
    </div>
  );
}

export function Badge({ app, size = "md" }: { app: string; size?: "sm" | "md" }) {
  const look = appLook(app);
  return (
    <span className={`badge badge-${size}`} style={{ background: look.color }} aria-hidden="true">
      {look.letters}
    </span>
  );
}

/** A row's avatar: its app's, or your agent's for a conversation. */
function RowBadge({ item }: { item: FeedItem }) {
  if (item.kind !== "message") return <Badge app={item.app} />;
  return (
    <span className={`badge badge-md ${item.from === "you" ? "badge-you" : "badge-agent"}`} aria-hidden="true">
      {item.from === "you" ? "You" : <Spark />}
    </span>
  );
}

function Spark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    </svg>
  );
}

function Bell() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 004 0" />
    </svg>
  );
}

function Who({ item }: { item: FeedItem }) {
  if (item.kind === "message" && item.from === "you") return <span className="who">You, to your agent</span>;
  if (item.kind === "action" || item.kind === "message") {
    return (
      <span className="who who-agent">
        <Spark />
        Your agent
      </span>
    );
  }
  return (
    <span className="who">
      <Bell />
      {item.from || appLook(item.app).name}
    </span>
  );
}

function Status({ item }: { item: FeedItem }) {
  const s = statusOf(item);
  return <span className={`pill pill-${s.tone}`}>{s.label}</span>;
}

type Decide = (d: "approve" | "decline" | "undo" | "keep") => void;

function Choices({ item, busy, onDecide, large }: { item: FeedItem; busy: boolean; onDecide: Decide; large?: boolean }) {
  const c = choicesFor(item);
  const size = large ? "" : "small";
  return (
    <>
      {c.approve && (
        <button type="button" className={`primary ${size}`} disabled={busy} onClick={() => onDecide("approve")}>
          {c.approve}
        </button>
      )}
      {c.decline && (
        <button type="button" className={`ghost ${size}`} disabled={busy} onClick={() => onDecide("decline")}>
          Decline
        </button>
      )}
      {c.keep && (
        <button type="button" className={`ghost ${size}`} disabled={busy} onClick={() => onDecide("keep")}>
          Keep it
        </button>
      )}
      {c.undo && (
        <button type="button" className={`ghost ${size}`} disabled={busy} onClick={() => onDecide("undo")}>
          Undo
        </button>
      )}
    </>
  );
}

/**
 * The fastest way to resolve a row, shaped by its ask.
 *
 * A reply is a text box (the agent's draft when it wrote one) with suggested
 * replies one tap away; a choice is one button per option; a confirm is one
 * button. On a notification the answer goes to `answer_notification`; on a
 * proposal it approves with that answer. Either way your agent carries it out.
 */
export function Resolver({ item, feed, compact }: { item: FeedItem; feed: Feed; compact?: boolean }) {
  const id = useId();
  const [text, setText] = useState(item.ask.draft);
  const isAction = item.kind === "action";
  const submit = (answer: string) =>
    isAction ? feed.resolve(item.id, "approve", answer) : feed.answer(item.id, answer);
  const size = compact ? "small" : "";
  const { kind, prompt, options } = item.ask;

  if (kind === "choose") {
    return (
      <div className="resolver" role="group" aria-label={prompt || "Choose"}>
        {prompt && <span className="resolver-prompt">{prompt}</span>}
        <div className="resolver-options">
          {options.map((o) => (
            <button key={o} type="button" className={`option ${size}`} disabled={feed.busy} onClick={() => void submit(o)}>
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (kind === "confirm") {
    return (
      <div className="resolver">
        <button type="button" className={`primary ${size}`} disabled={feed.busy} onClick={() => void submit("")}>
          {prompt || "Confirm"}
        </button>
      </div>
    );
  }

  // reply
  return (
    <form
      className="resolver"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) void submit(text.trim());
      }}
    >
      <label htmlFor={`${id}-reply`} className="resolver-prompt">
        {prompt || "Reply"}
      </label>
      {options.length > 0 && (
        <div className="chips" aria-label="Suggested replies">
          {options.map((o) => (
            <button key={o} type="button" className="chip" onClick={() => setText(o)}>
              {o}
            </button>
          ))}
        </div>
      )}
      <div className="reply-row">
        <textarea
          id={`${id}-reply`}
          value={text}
          rows={compact ? 2 : 3}
          placeholder="Write a reply…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) void submit(text.trim());
          }}
        />
        <button type="submit" className={`primary ${size}`} disabled={feed.busy || !text.trim()}>
          {isAction ? "Approve & send" : "Send"}
        </button>
      </div>
    </form>
  );
}

/** Everything a row needs to be settled: its resolver and its plain decisions. */
function Settle({ item, feed, compact }: { item: FeedItem; feed: Feed; compact?: boolean }) {
  return (
    <>
      {resolvable(item) && <Resolver key={item.id} item={item} feed={feed} compact={compact} />}
      <div className="actions">
        <Choices item={item} busy={feed.busy} onDecide={(d) => void feed.resolve(item.id, d)} large={!compact} />
      </div>
    </>
  );
}

function Card({
  item,
  feed,
  selected,
  onSelect,
}: {
  item: FeedItem;
  feed: Feed;
  selected: boolean;
  onSelect: () => void;
}) {
  const look = appLook(item.app);
  const [open, setOpen] = useState(false);
  const flowId = useId();
  return (
    <article className={`card ${selected ? "selected" : ""} ${item.needs_you ? "needs" : ""}`}>
      <RowBadge item={item} />
      <div className="card-body">
        <div className="meta">
          <Who item={item} />
          {item.app && (
            <span>
              in {look.name}
              {item.source_label ? ` · ${item.source_label}` : ""}
            </span>
          )}
          {item.item_type && <span className="type-tag">{TYPE_LABELS[item.item_type] ?? item.item_type}</span>}
          <span className="time">{timeLabel(item.at)}</span>
        </div>
        <button type="button" className="title" onClick={onSelect}>
          {item.title}
        </button>
        {item.body && item.body !== item.title && (item.kind === "action" ? <p>{item.body}</p> : <p className="quote">{item.body}</p>)}
        <Typed item={item} />
        {item.breach && <p className="breach">Your agent {item.breach}.</p>}
        {item.note && <p className="note">{answerLine(item)}</p>}
        <LateHint item={item} />
        {resolvable(item) && <Resolver key={item.id} item={item} feed={feed} compact />}
        <div className="actions">
          <Status item={item} />
          <Choices item={item} busy={feed.busy} onDecide={(d) => void feed.resolve(item.id, d)} />
          {item.chain_len > 1 && (
            <button
              type="button"
              className="link small"
              aria-expanded={open}
              aria-controls={flowId}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? "Hide the flow" : `Show the flow · ${item.chain_len} steps`}
            </button>
          )}
          <button type="button" className="link small" onClick={onSelect}>
            Details
          </button>
        </div>
        {open && (
          <div id={flowId}>
            <Flow chain={item.chain} lead={item.id} feed={feed} />
          </div>
        )}
      </div>
    </article>
  );
}

/** What was said on the latest step, as a line under the row. */
function answerLine(item: FeedItem): string {
  if (item.kind === "notification") {
    if (item.status === "answered") return item.ask.kind === "reply" ? `You replied: "${item.note}"` : `You chose "${item.note}"`;
    return item.note;
  }
  if (item.status === "approved" && item.ask.kind === "choose") return `You picked "${item.note}"`;
  if (item.status === "approved" && item.ask.kind === "reply") return `You approved: "${item.note}"`;
  return item.note;
}

/**
 * A chain's whole flow, oldest first: what arrived, what the agent did, what
 * you decided, and what came of it. Anything in it still waiting on you can be
 * settled from right here.
 */
function Flow({ chain, lead, feed }: { chain: string; lead: string; feed: Feed }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const { loadChain, page } = feed;
  useEffect(() => {
    let live = true;
    loadChain(chain)
      .then((rows) => live && setItems(rows))
      .catch((e: unknown) => live && setFailed(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
    // `page` is the point: re-read the flow whenever the feed changes.
  }, [chain, loadChain, page]);

  if (failed) return <p className="err">{failed}</p>;
  if (!items) return <p className="muted">Loading the flow…</p>;
  const steps = flowOf(items, appName);
  const lastStepOf = new Map<string, string>();
  for (const s of steps) lastStepOf.set(s.item.id, s.key);

  return (
    <ol className="flow" aria-label="The whole flow">
      {steps.map((s) => (
        <li key={s.key} className={`flow-step actor-${s.actor} tone-${s.tone}`}>
          <span className="flow-dot" aria-hidden="true">
            {s.actor === "agent" ? <Spark /> : s.actor === "app" ? <Bell /> : null}
          </span>
          <div className="flow-body">
            <div className="flow-meta">
              <strong>{s.who}</strong>
              {s.first && s.item.app && <span className="muted">in {appName(s.item.app)}{s.item.source_label ? ` · ${s.item.source_label}` : ""}</span>}
              <span className="time">{timeLabel(s.at)}</span>
            </div>
            <p className={s.first ? "flow-title" : ""}>{s.text}</p>
            {s.detail && <p className="flow-detail">{s.detail}</p>}
            {!s.first && items.length > 1 && (
              <p className="flow-about">on: {s.item.title.length > 70 ? `${s.item.title.slice(0, 70)}…` : s.item.title}</p>
            )}
            {s.item.id !== lead && s.item.needs_you && lastStepOf.get(s.item.id) === s.key && (
              <div className="flow-settle">
                <Settle item={s.item} feed={feed} compact />
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Detail({ item, feed }: { item: FeedItem; feed: Feed }) {
  const look = appLook(item.app);
  const rows: [string, string, boolean?][] =
    item.kind === "message"
      ? [
          ["Said by", item.from === "you" ? "You" : "Your agent"],
          ["Chain", short(item.chain), true],
          ["Delivered", "Through your own node"],
        ]
      : item.kind === "action"
      ? [
          ["Acted as", "You — the agent signs as your account"],
          ["Executor", item.executor || "Not executed yet"],
          ["App", `${look.name}${item.source_label ? ` · ${item.source_label}` : ""}`],
          ["Context", item.source_context ? short(item.source_context) : "—", true],
          ["Method", item.method, true],
          ["Guard", item.category || "none"],
          ["Intent hash", item.intent_hash ? short(item.intent_hash) : "—", true],
        ]
      : [
          ["From", item.from || "—"],
          ["App", `${look.name}${item.source_label ? ` · ${item.source_label}` : ""}`],
          ["Context", item.source_context ? short(item.source_context) : "—", true],
          ["Event", item.event || "—", true],
          ...(item.item_type ? ([["Read as", TYPE_LABELS[item.item_type] ?? item.item_type]] as [string, string][]) : []),
          ...(item.reply_call
            ? ([["Answered by", `Your feed, with ${replyMethod(item)} in ${look.name}`, false]] as [string, string, boolean][])
            : []),
          ["Delivered", "Live from your own node"],
        ];
  const flow: FlowStep[] = flowOf([item], appName);
  return (
    <div className="detail-inner">
      <div className="detail-head">
        <RowBadge item={item} />
        <div>
          <p className="muted">
            {item.kind === "message"
              ? "Conversation with your agent"
              : `${item.kind === "action" ? "Agent action" : "Notification"} · ${look.name}`}
          </p>
          <p className="muted">{new Date(item.at).toLocaleString()}</p>
        </div>
      </div>
      {/* An answer reads in the flow below; as a heading it would be a paragraph. */}
      <h2>{item.kind === "message" && item.from === "agent" ? (item.reply_to ? "Your agent answered" : "A note from your agent") : item.title}</h2>
      <Status item={item} />
      <LateHint item={item} />
      {item.breach && <p className="breach">Your agent {item.breach}. Keep it, or undo it if you can.</p>}
      {(resolvable(item) || choicesFor(item).approve || choicesFor(item).decline || choicesFor(item).undo || choicesFor(item).keep) && (
        <section className="detail-settle">
          <Settle item={item} feed={feed} />
        </section>
      )}
      {item.why && (
        <section>
          <h3>Why the agent did this</h3>
          <p>{item.why}</p>
        </section>
      )}
      <section>
        <h3>{item.chain_len > 1 ? `The whole flow · ${item.chain_len} steps` : "What happened"}</h3>
        {item.chain_len > 1 ? (
          <Flow chain={item.chain} lead={item.id} feed={feed} />
        ) : (
          <ol className="flow">
            {flow.map((s) => (
              <li key={s.key} className={`flow-step actor-${s.actor} tone-${s.tone}`}>
                <span className="flow-dot" aria-hidden="true">
                  {s.actor === "agent" ? <Spark /> : s.actor === "app" ? <Bell /> : null}
                </span>
                <div className="flow-body">
                  <div className="flow-meta">
                    <strong>{s.who}</strong>
                    <span className="time">{timeLabel(s.at)}</span>
                  </div>
                  <p>{s.text}</p>
                  {s.detail && <p className="flow-detail">{s.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="detail-ask">
        <AskAgent
          key={item.chain}
          feed={feed}
          chain={item.chain}
          label={item.kind === "message" ? "Say more to your agent" : "Talk to your agent about this"}
        />
      </section>
      <section>
        <h3>{item.kind === "action" ? "Provenance" : item.kind === "message" ? "About" : "Source"}</h3>
        <dl className="facts">
          {rows.map(([k, v, mono]) => (
            <div key={k} className="fact">
              <dt>{k}</dt>
              <dd className={mono ? "mono" : ""}>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

/**
 * Talk to your agent: about a chain, or with `chain` "" about anything, which
 * starts a chain of its own. Your agent answers in that chain, and whatever it
 * proposes or does because of it lands there too, under your rules.
 */
export function AskAgent({
  feed,
  chain,
  label,
  onPosted,
}: {
  feed: Feed;
  chain: string;
  label: string;
  onPosted?: (message: FeedItem) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const send = async () => {
    const t = text.trim();
    if (!t || feed.busy) return;
    const posted = await feed.say(chain, t);
    if (!posted) return;
    setText("");
    onPosted?.(posted);
  };
  return (
    <form
      className="ask"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label htmlFor={`${id}-ask`} className="ask-label">
        <Spark />
        {label}
      </label>
      <div className="reply-row">
        <textarea
          id={`${id}-ask`}
          value={text}
          rows={2}
          placeholder={chain ? "Ask about this, or tell your agent what to do next…" : "Ask a question or hand your agent a task…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
          }}
        />
        <button type="submit" className="primary" disabled={feed.busy || !text.trim()}>
          Send
        </button>
      </div>
    </form>
  );
}

/** How long a message may wait before the feed wonders where your agent is. */
const AGENT_LATE_MS = 10_000;

/** Under a message nothing has picked up: a hint that no agent may be running. */
function LateHint({ item }: { item: FeedItem }) {
  const waiting = item.kind === "message" && item.from === "you" && item.status === "waiting";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!waiting) return;
    const left = item.status_at + AGENT_LATE_MS - Date.now();
    if (left <= 0) {
      setNow(Date.now());
      return;
    }
    const timer = window.setTimeout(() => setNow(Date.now()), left);
    return () => window.clearTimeout(timer);
  }, [waiting, item.status_at]);
  if (!waiting || now - item.status_at < AGENT_LATE_MS) return null;
  return (
    <p className="hint" role="status">
      Nothing has picked this up yet. Is your agent running and connected to this feed?
    </p>
  );
}

function replyMethod(item: FeedItem): string {
  try {
    return (JSON.parse(item.reply_call) as { method?: string }).method ?? "a call";
  } catch {
    return "a call";
  }
}

/**
 * What a typed card adds under its title: the type's facts (when, due, the
 * game), and a poll's options when it cannot be answered from here.
 */
function Typed({ item }: { item: FeedItem }) {
  if (!item.item_type) return null;
  const facts = typedFacts(item);
  const f = fieldsOf(item);
  const options = item.item_type === "poll" && !resolvable(item) && Array.isArray(f.options) ? (f.options as unknown[]).map(String) : [];
  if (facts.length === 0 && options.length === 0) return null;
  return (
    <div className="typed">
      {facts.length > 0 && (
        <dl className="typed-facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {options.length > 0 && (
        <div className="chips" aria-label="Options">
          {options.map((o) => (
            <span key={o} className="chip static">
              {o}
            </span>
          ))}
          <span className="muted small-text">Vote in {appLook(item.app).name}</span>
        </div>
      )}
    </div>
  );
}
