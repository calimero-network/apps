import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FeedItem } from "./generated/HyperfeedClient";
import type { Feed } from "./useFeed";
import { appLook } from "./apps";
import { canOpen } from "./links";
import { agentLive, notPickedUp } from "./theme";
import {
  choicesFor,
  fieldsOf,
  flowOf,
  laneOf,
  progressLine,
  resolvable,
  statusOf,
  timeLabel,
  TYPE_LABELS,
  typedFacts,
  type Lane,
} from "./format";

const appName = (key: string) => appLook(key).name;

/** How long "Later" puts a row away. */
export const LATER_MS = 3 * 60 * 60 * 1000;

/** How many done rows show before "Show all". */
const DONE_SHOWN = 5;

const LANES: { id: Lane; label: string; empty: string }[] = [
  { id: "todo", label: "To do", empty: "Nothing needs you." },
  { id: "progress", label: "In progress", empty: "Nothing underway." },
  { id: "done", label: "Done", empty: "Nothing finished yet." },
];

/** Making a feed with the Hyperfeed installed now: only on a node. */
export interface NewFeed {
  create: () => Promise<void>;
  busy: boolean;
  failed: string | null;
}

export function NewFeedButton({ newFeed }: { newFeed: NewFeed }) {
  return (
    <span className="notice-action">
      <button type="button" className="primary small" disabled={newFeed.busy} onClick={() => void newFeed.create()}>
        {newFeed.busy ? "Creating…" : "Create a new feed"}
      </button>
      {newFeed.failed && <span className="err">{newFeed.failed}</span>}
    </span>
  );
}

/**
 * The feed as three lanes: what needs you, what is underway, what is done.
 *
 * One row per chain. The row you are on opens in place with everything about
 * it (the thread, the answer, the actions); nothing is shown twice. Done rows
 * are archived out of the way, one at a time or all at once, and come back on
 * their own when something new happens in them.
 */
export function FeedView({
  feed,
  query,
  newFeed,
  onChat,
  openLink,
}: {
  feed: Feed;
  query: string;
  newFeed?: NewFeed;
  /** Open a chat with your agent; without it, a new conversation opens in place. */
  onChat?: (chain: string) => void;
  /** The signed-in address that shows a row in its app; without it, rows have no Open. */
  openLink?: (item: FeedItem) => Promise<string | null>;
}) {
  const { page } = feed;
  const archivedView = feed.filter === "archived";
  const [open, setOpen] = useState<string | null>(null);
  const [allDone, setAllDone] = useState(false);
  const [panel, setPanel] = useState<{ url: string; title: string } | null>(null);

  const items = useMemo(() => {
    const all = page?.items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((i) =>
      [i.title, i.body, i.from, i.source_label, appLook(i.app).name, i.method].join(" ").toLowerCase().includes(q),
    );
  }, [page, query]);

  const lanes = useMemo(() => {
    const by: Record<Lane, FeedItem[]> = { todo: [], progress: [], done: [] };
    for (const i of items) by[laneOf(i)].push(i);
    return by;
  }, [items]);

  // The rows in the order the keys move through them.
  const order = useMemo(() => {
    if (archivedView) return items;
    const done = allDone ? lanes.done : lanes.done.slice(0, DONE_SHOWN);
    return [...lanes.todo, ...lanes.progress, ...done];
  }, [archivedView, items, lanes, allDone]);

  // Opening a notification is reading it.
  const { markSeen } = feed;
  const current = order.find((i) => i.chain === open) ?? null;
  useEffect(() => {
    if (current && current.kind === "notification" && !current.seen) void markSeen([current.id]);
  }, [current, markSeen]);

  const openApp = useCallback(
    async (item: FeedItem) => {
      if (!openLink) return;
      const url = await openLink(item);
      if (url) setPanel({ url, title: `${appName(item.app)}${item.source_label ? ` · ${item.source_label}` : ""}` });
    },
    [openLink],
  );

  // After a row leaves its lane, the next one opens: hammer through them.
  const step = useCallback(
    (from: FeedItem | null, by: number) => {
      if (order.length === 0) return setOpen(null);
      const at = from ? order.findIndex((i) => i.chain === from.chain) : -1;
      const next = order[Math.min(Math.max(at + by, 0), order.length - 1)];
      setOpen(next?.chain ?? null);
    },
    [order],
  );

  const archive = useCallback(
    (item: FeedItem) => {
      step(item, 1);
      void feed.archive([item.chain]);
    },
    [feed, step],
  );
  const later = useCallback(
    (item: FeedItem) => {
      step(item, 1);
      void feed.later(item.chain, Date.now() + LATER_MS, "Back in 3 hours");
    },
    [feed, step],
  );

  // The keys: J/K move, E archive, S later, O open in its app, U undo, Esc close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "escape") {
        if (panel) setPanel(null);
        else setOpen(null);
        return;
      }
      if (k === "j") step(current, current ? 1 : 0);
      else if (k === "k") step(current, -1);
      else if (k === "e" && current && !archivedView) archive(current);
      else if (k === "s" && current && !archivedView) later(current);
      else if (k === "o" && current && canOpen(current)) void openApp(current);
      else if (k === "u" && feed.toast) feed.toast.undo();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, current, archive, later, openApp, archivedView, panel, feed.toast]);

  const rowProps = {
    feed,
    onChat,
    onOpenApp: openLink ? openApp : undefined,
    onArchive: archive,
    onLater: later,
  };

  return (
    <div className={`feed-page ${panel ? "with-panel" : ""}`}>
      <main className="feed-main">
        <AskAgent feed={feed} chain="" label="Ask your agent" onPosted={(m) => (onChat ? onChat(m.chain) : setOpen(m.chain))} />

        {feed.outdated && (
          <div className="notice" role="status">
            Your feed was made by an earlier Hyperfeed. It still works, but it can't hold lenses or typed items: those need a feed made by the Hyperfeed installed now.
            {newFeed && <NewFeedButton newFeed={newFeed} />}
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

        {!page && !feed.error && <div className="empty">Loading the feed…</div>}

        {page && archivedView && (
          <section className="lane" aria-label="Archived">
            <header className="lane-head">
              <h2>Archived</h2>
              <span className="lane-count">{items.length}</span>
              <button type="button" className="link small lane-action" onClick={() => feed.setFilter("all")}>
                Back to the feed
              </button>
            </header>
            {items.length === 0 ? (
              <p className="lane-empty">Nothing archived.</p>
            ) : (
              <ul className="rows">
                {items.map((item) => (
                  <Row key={item.chain} item={item} lane="done" archived expanded={open === item.chain} onToggle={() => setOpen(open === item.chain ? null : item.chain)} {...rowProps} />
                ))}
              </ul>
            )}
          </section>
        )}

        {page && !archivedView && (
          <>
            {query && items.length === 0 && <div className="empty">Nothing matches that search.</div>}
            {LANES.map((lane) => {
              const rows = lanes[lane.id];
              const shown = lane.id === "done" && !allDone ? rows.slice(0, DONE_SHOWN) : rows;
              return (
                <section key={lane.id} className={`lane lane-${lane.id}`} aria-label={lane.label}>
                  <header className="lane-head">
                    <h2>{lane.label}</h2>
                    <span className="lane-count">{rows.length}</span>
                    {lane.id === "done" && rows.length > 0 && (
                      <button
                        type="button"
                        className="link small lane-action"
                        disabled={feed.busy}
                        onClick={() => void feed.archive(rows.map((r) => r.chain), `Archived ${rows.length} done`)}
                      >
                        Archive all done
                      </button>
                    )}
                  </header>
                  {rows.length === 0 ? (
                    <p className="lane-empty">{lane.empty}</p>
                  ) : (
                    <ul className="rows">
                      {shown.map((item) => (
                        <Row
                          key={item.chain}
                          item={item}
                          lane={lane.id}
                          expanded={open === item.chain}
                          onToggle={() => setOpen(open === item.chain ? null : item.chain)}
                          {...rowProps}
                        />
                      ))}
                    </ul>
                  )}
                  {lane.id === "done" && rows.length > DONE_SHOWN && (
                    <button type="button" className="link small lane-more" onClick={() => setAllDone((v) => !v)}>
                      {allDone ? "Show fewer" : `Show all ${rows.length}`}
                    </button>
                  )}
                </section>
              );
            })}
            <footer className="feed-foot">
              <button type="button" className="link small" onClick={() => feed.setFilter("archived")}>
                Archived{page.counts.archived ? ` · ${page.counts.archived}` : ""}
              </button>
              <span className="keys" aria-hidden="true">
                <kbd>J</kbd>/<kbd>K</kbd> move · <kbd>E</kbd> archive · <kbd>S</kbd> later · <kbd>O</kbd> open · <kbd>U</kbd> undo
              </span>
            </footer>
          </>
        )}
      </main>

      {panel && <AppPanel url={panel.url} title={panel.title} onClose={() => setPanel(null)} />}

      {feed.toast && (
        <div className="toast" role="status">
          <span>{feed.toast.text}</span>
          <button type="button" className="toast-undo" onClick={feed.toast.undo}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * What the panel lets the app inside it do. Above all, reach your node: the
 * app talks to it on localhost or your network, and Chrome blocks that from
 * a cross-origin frame unless the page around it passes its own permission
 * on (Local Network Access). Without it the app's login fails with "Failed to
 * connect", though the same app works in a tab of its own. Chrome named the
 * permission `local-network-access`, then split it into `local-network` and
 * `loopback-network`; a browser ignores the names it does not know.
 */
export const APP_PANEL_ALLOW = "local-network-access; local-network; loopback-network; clipboard-read; clipboard-write";

/** An app, open beside the feed, at the row it was opened from. */
function AppPanel({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  return (
    <aside className="app-panel" aria-label={title}>
      <header className="app-panel-head">
        <strong>{title}</strong>
        <a className="link small" href={url} target="_blank" rel="noopener noreferrer" onClick={onClose}>
          Open in a tab
        </a>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <iframe title={title} src={url} className="app-panel-frame" allow={APP_PANEL_ALLOW} />
    </aside>
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

/** Who a row is from, and where: one short line. */
function whereOf(item: FeedItem): string {
  const who =
    item.kind === "message" && item.from === "you"
      ? "You, to your agent"
      : item.kind === "action" || item.kind === "message"
        ? "Your agent"
        : item.from || appName(item.app);
  const app = item.app ? ` · ${appName(item.app)}${item.source_label ? ` ${item.source_label}` : ""}` : "";
  return `${who}${app}`;
}

function Status({ item }: { item: FeedItem }) {
  const s = statusOf(item);
  return <span className={`pill pill-${s.tone}`}>{s.label}</span>;
}

type Decide = (d: "approve" | "decline" | "undo" | "keep") => void;

function Choices({ item, busy, onDecide }: { item: FeedItem; busy: boolean; onDecide: Decide }) {
  const c = choicesFor(item);
  return (
    <>
      {c.approve && (
        <button type="button" className="primary small" disabled={busy} onClick={() => onDecide("approve")}>
          {c.approve}
        </button>
      )}
      {c.decline && (
        <button type="button" className="ghost small" disabled={busy} onClick={() => onDecide("decline")}>
          Decline
        </button>
      )}
      {c.keep && (
        <button type="button" className="ghost small" disabled={busy} onClick={() => onDecide("keep")}>
          Keep it
        </button>
      )}
      {c.undo && (
        <button type="button" className="ghost small" disabled={busy} onClick={() => onDecide("undo")}>
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
 * proposal it approves with that answer; on your agent's question it is your
 * next message in the chain. Either way your agent carries it out.
 */
export function Resolver({ item, feed }: { item: FeedItem; feed: Feed }) {
  const id = useId();
  const [text, setText] = useState(item.ask.draft);
  const isAction = item.kind === "action";
  const submit = async (answer: string) => {
    if (isAction) return feed.resolve(item.id, "approve", answer);
    if (item.kind === "message") return void (await feed.say(item.chain, answer));
    return feed.answer(item.id, answer);
  };
  const { kind, prompt, options } = item.ask;

  if (kind === "choose") {
    return (
      <div className="resolver" role="group" aria-label={prompt || "Choose"}>
        {prompt && <span className="resolver-prompt">{prompt}</span>}
        <div className="resolver-options">
          {options.map((o) => (
            <button key={o} type="button" className="option small" disabled={feed.busy} onClick={() => void submit(o)}>
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
        <button type="button" className="primary small" disabled={feed.busy} onClick={() => void submit("")}>
          {prompt || "Confirm"}
        </button>
      </div>
    );
  }

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
          rows={2}
          placeholder="Write a reply…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) void submit(text.trim());
          }}
        />
        <button type="submit" className="primary small" disabled={feed.busy || !text.trim()}>
          {isAction ? "Approve & send" : "Send"}
        </button>
      </div>
    </form>
  );
}

/** What was said on the latest step, as a line under the row. */
function answerLine(item: FeedItem): string {
  if (item.kind === "notification") {
    if (item.status === "answered") return item.ask.kind === "reply" ? `You replied: "${item.note}"` : `You chose "${item.note}"`;
    return item.note;
  }
  if (item.kind === "message" && item.status === "answered" && item.from === "agent") return `You answered: "${item.note}"`;
  if (item.status === "approved" && item.ask.kind === "choose") return `You picked "${item.note}"`;
  if (item.status === "approved" && item.ask.kind === "reply") return `You approved: "${item.note}"`;
  return item.note;
}

/** The body, when it says more than the title it starts with. */
function extraBody(item: FeedItem): string {
  const body = item.body.trim();
  const title = item.title.replace(/…$/, "").trim();
  if (!body || body === title) return "";
  return body;
}

function Row({
  item,
  lane,
  archived,
  expanded,
  onToggle,
  feed,
  onChat,
  onOpenApp,
  onArchive,
  onLater,
}: {
  item: FeedItem;
  lane: Lane;
  archived?: boolean;
  expanded: boolean;
  onToggle: () => void;
  feed: Feed;
  onChat?: (chain: string) => void;
  onOpenApp?: (item: FeedItem) => void;
  onArchive: (item: FeedItem) => void;
  onLater: (item: FeedItem) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const bodyId = useId();
  useEffect(() => {
    if (expanded) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [expanded]);
  const body = extraBody(item);
  const openable = Boolean(onOpenApp) && canOpen(item);
  return (
    <li ref={ref} className={`row ${expanded ? "open" : ""} ${item.needs_you ? "needs" : ""}`}>
      <button type="button" className="row-line" aria-expanded={expanded} aria-controls={bodyId} onClick={onToggle}>
        <RowBadge item={item} />
        <span className="row-text">
          <span className="row-title">{item.title}</span>
          <span className="row-where">{progressLine(item) ? `Working: ${progressLine(item)}` : whereOf(item)}</span>
        </span>
        <Status item={item} />
        {item.chain_len > 1 && <span className="row-steps">{item.chain_len}</span>}
        <span className="row-time">{timeLabel(item.chain_at || item.at)}</span>
      </button>
      {expanded && (
        <div id={bodyId} className="row-body">
          {body && (item.kind === "action" ? <p>{body}</p> : <p className="quote">{body}</p>)}
          <Typed item={item} />
          {item.breach && <p className="breach">Your agent {item.breach}.</p>}
          {item.why && item.kind === "action" && <p className="why">Why: {item.why}</p>}
          {item.note && <p className="note">{answerLine(item)}</p>}
          <LateHint item={item} live={agentLive(feed.settings?.agents)} />
          {resolvable(item) && (
            <div className="row-answer">
              <Resolver key={item.id} item={item} feed={feed} />
            </div>
          )}
          {/* The decision comes before the flow: a long history must not push Approve out of reach. */}
          <div className="actions">
            <Choices item={item} busy={feed.busy} onDecide={(d) => void feed.resolve(item.id, d)} />
            {openable && (
              <button type="button" className="ghost small" onClick={() => onOpenApp?.(item)}>
                Open in {appName(item.app)}
                <kbd>O</kbd>
              </button>
            )}
            {onChat && item.kind === "message" && (
              <button type="button" className="ghost small" onClick={() => onChat(item.chain)}>
                Open chat
              </button>
            )}
            <span className="grow" />
            {archived ? (
              <button type="button" className="ghost small" disabled={feed.busy} onClick={() => void feed.unarchive([item.chain])}>
                Unarchive
              </button>
            ) : (
              <>
                {lane !== "done" && (
                  <button type="button" className="ghost small" disabled={feed.busy} onClick={() => onLater(item)}>
                    Later
                    <kbd>S</kbd>
                  </button>
                )}
                <button type="button" className="ghost small" disabled={feed.busy} onClick={() => onArchive(item)}>
                  Archive
                  <kbd>E</kbd>
                </button>
              </>
            )}
          </div>
          {item.chain_len > 1 && <Flow chain={item.chain} lead={item.id} feed={feed} />}
          <AskAgent
            key={item.chain}
            feed={feed}
            chain={item.chain}
            label={item.kind === "message" ? "Say more to your agent" : "Talk to your agent about this"}
          />
        </div>
      )}
    </li>
  );
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
              {s.first && s.item.app && (
                <span className="muted">
                  in {appName(s.item.app)}
                  {s.item.source_label ? ` · ${s.item.source_label}` : ""}
                </span>
              )}
              <span className="time">{timeLabel(s.at)}</span>
            </div>
            <p className={s.first ? "flow-title" : ""}>{s.text}</p>
            {s.detail && <p className="flow-detail">{s.detail}</p>}
            {s.item.id !== lead && s.item.needs_you && lastStepOf.get(s.item.id) === s.key && (
              <div className="flow-settle">
                {resolvable(s.item) && <Resolver key={s.item.id} item={s.item} feed={feed} />}
                <div className="actions">
                  <Choices item={s.item} busy={feed.busy} onDecide={(d) => void feed.resolve(s.item.id, d)} />
                </div>
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
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
      className={`ask ${chain ? "ask-inline" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label htmlFor={`${id}-ask`} className="ask-label">
        <Spark />
        <span className={chain ? "" : "sr-only"}>{label}</span>
      </label>
      <textarea
        id={`${id}-ask`}
        value={text}
        rows={1}
        aria-label={label}
        placeholder={chain ? "Ask about this, or tell your agent what to do next…" : "Tell your agent… (Enter to send)"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <button type="submit" className="primary small" disabled={feed.busy || !text.trim()}>
        Send
      </button>
    </form>
  );
}

/** How long a message may wait before the feed wonders where your agent is. */
const AGENT_LATE_MS = 10_000;

/** Under a message nothing has picked up: a hint that no agent may be running. */
function LateHint({ item, live }: { item: FeedItem; live: boolean }) {
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
      {notPickedUp(live)}
    </p>
  );
}

/**
 * What a typed row adds: the type's facts (when, due, the game), and a poll's
 * options when it cannot be answered from here.
 */
function Typed({ item }: { item: FeedItem }) {
  if (!item.item_type) return null;
  const facts = typedFacts(item);
  const f = fieldsOf(item);
  const options = item.item_type === "poll" && !resolvable(item) && Array.isArray(f.options) ? (f.options as unknown[]).map(String) : [];
  return (
    <div className="typed">
      <span className="type-tag">{TYPE_LABELS[item.item_type] ?? item.item_type}</span>
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
