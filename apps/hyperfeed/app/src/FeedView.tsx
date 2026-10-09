import { useEffect, useMemo, useState } from "react";
import type { FeedItem } from "./generated/HyperfeedClient";
import type { Filter } from "./backend";
import type { Feed } from "./useFeed";
import { pickSelected } from "./useFeed";
import { appLook } from "./apps";
import { choicesFor, groupByDay, short, statusOf, timeLabel } from "./format";

const TABS: { id: Filter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "agent", label: "Agent actions" },
  { id: "notifications", label: "Notifications" },
  { id: "needs_you", label: "Needs you" },
];

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
                key={item.id}
                item={item}
                selected={current?.id === item.id}
                busy={feed.busy}
                onSelect={() => setSelected(item.id)}
                onDecide={(d) => void feed.resolve(item.id, d)}
              />
            ))}
          </section>
        ))}
      </main>

      <aside className="detail" aria-label="Selected item">
        {current ? (
          <Detail item={current} busy={feed.busy} onDecide={(d) => void feed.resolve(current.id, d)} />
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

function Who({ item }: { item: FeedItem }) {
  if (item.kind === "action") {
    return (
      <span className="who who-agent">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
        </svg>
        Your agent
      </span>
    );
  }
  return (
    <span className="who">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z" />
        <path d="M10 20.5a2 2 0 004 0" />
      </svg>
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

function Card({
  item,
  selected,
  busy,
  onSelect,
  onDecide,
}: {
  item: FeedItem;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onDecide: Decide;
}) {
  const look = appLook(item.app);
  return (
    <article className={`card ${selected ? "selected" : ""} ${item.needs_you ? "needs" : ""}`}>
      <Badge app={item.app} />
      <div className="card-body">
        <div className="meta">
          <Who item={item} />
          <span>
            in {look.name}
            {item.source_label ? ` · ${item.source_label}` : ""}
          </span>
          <span className="time">{timeLabel(item.at)}</span>
        </div>
        <button type="button" className="title" onClick={onSelect}>
          {item.title}
        </button>
        {item.body && (item.kind === "notification" ? <p className="quote">{item.body}</p> : <p>{item.body}</p>)}
        {item.breach && <p className="breach">Your agent {item.breach}.</p>}
        {item.note && item.kind === "action" && <p className="note">{item.note}</p>}
        <div className="actions">
          <Status item={item} />
          <Choices item={item} busy={busy} onDecide={onDecide} />
          <button type="button" className="link small" onClick={onSelect}>
            Details
          </button>
        </div>
      </div>
    </article>
  );
}

function Detail({ item, busy, onDecide }: { item: FeedItem; busy: boolean; onDecide: Decide }) {
  const look = appLook(item.app);
  const rows: [string, string, boolean?][] =
    item.kind === "action"
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
          ["Delivered", "Live from your own node"],
        ];
  return (
    <div className="detail-inner">
      <div className="detail-head">
        <Badge app={item.app} />
        <div>
          <p className="muted">
            {item.kind === "action" ? "Agent action" : "Notification"} · {look.name}
          </p>
          <p className="muted">{new Date(item.at).toLocaleString()}</p>
        </div>
      </div>
      <h2>{item.title}</h2>
      <Status item={item} />
      {item.breach && <p className="breach">Your agent {item.breach}. Keep it, or undo it if you can.</p>}
      {item.why && (
        <section>
          <h3>Why the agent did this</h3>
          <p>{item.why}</p>
        </section>
      )}
      {item.note && (
        <section>
          <h3>Latest note</h3>
          <p>{item.note}</p>
        </section>
      )}
      <section>
        <h3>{item.kind === "action" ? "Provenance" : "Source"}</h3>
        <dl className="facts">
          {rows.map(([k, v, mono]) => (
            <div key={k} className="fact">
              <dt>{k}</dt>
              <dd className={mono ? "mono" : ""}>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="detail-actions">
        <Choices item={item} busy={busy} onDecide={onDecide} large />
      </div>
    </div>
  );
}
