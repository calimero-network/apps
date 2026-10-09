import { useEffect, useState } from "react";

type Row = { app: string; ab: string; meta: string; title: string; pill: string };

/** What arrives in To do, one after another, while the hero is on screen. */
const INCOMING: Row[] = [
  { app: "chat", ab: "Ch", meta: "Chat · #launch · Maya", title: "Can your agent pull the Q3 numbers?", pill: "Reply" },
  { app: "issues", ab: "Is", meta: "Issues · Ops board", title: "Assigned to you: fix the login redirect", pill: "Needs you" },
  { app: "calendar", ab: "Ca", meta: "Calendar · Maya", title: "Pick a time: Today 12:30 or 13:15", pill: "Choose" },
  { app: "design", ab: "De", meta: "Design · Launch kit", title: "Jordan commented on the hero frame", pill: "Reply" },
  { app: "sheets", ab: "Sh", meta: "Sheets · Budget", title: "Approve the Q4 budget edit", pill: "Needs you" },
];

const PROGRESS: Row[] = [
  { app: "calendar", ab: "Ca", meta: "Calendar · because Maya asked", title: "Booking 20 minutes with Maya", pill: "Carrying out" },
  { app: "you", ab: "Yo", meta: "You asked your agent", title: "Draft the launch post", pill: "Thinking" },
];

const DONE: Row[] = [
  { app: "chat", ab: "Ch", meta: "Chat · #eng-standup", title: "Posted your stand-up", pill: "Done" },
  { app: "design", ab: "De", meta: "Design · Hyperfeed", title: "Created “10 ideas to improve Hyperfeed”", pill: "Done" },
];

const STEP_MS = 3200;

export function Badge({ app, ab }: { app: string; ab: string }) {
  return (
    <span className={`hl-badge hl-b-${app}`} aria-hidden="true">
      {ab}
    </span>
  );
}

function Line({ row, tone, fresh }: { row: Row; tone: "wait" | "busy" | "good"; fresh?: boolean }) {
  return (
    <div className={`hl-row${fresh ? " hl-row-new" : ""}${tone === "good" ? " hl-row-done" : ""}`}>
      <Badge app={row.app} ab={row.ab} />
      <div className="hl-row-text">
        <div className="hl-row-meta">{row.meta}</div>
        <div className="hl-row-title">{row.title}</div>
      </div>
      <span className={`hl-pill hl-pill-${tone}`}>{row.pill}</span>
    </div>
  );
}

/**
 * The hero: the feed as it looks, with new rows arriving in To do. Drawn, not
 * a screenshot, so it follows the theme; still for anyone who asked for less
 * motion.
 */
export function LiveFeed() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => {
      if (!document.hidden) setTick((n) => n + 1);
    }, STEP_MS);
    return () => clearInterval(t);
  }, []);
  const todo = [0, 1, 2].map((i) => INCOMING[(tick + i) % INCOMING.length]!);

  return (
    <div
      className="hl-window"
      role="img"
      aria-label="The Hyperfeed app: a permission request from mero-bot and messages from your apps in To do, your agent's work in progress, and what is done"
    >
      <div className="hl-window-bar">
        <span className="hl-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="hl-seg">
          <span className="on">Feed</span>
          <span>Chat</span>
          <span>Controls</span>
        </span>
        <span className="hl-pill hl-pill-good hl-live">
          <span className="hl-pulse" />
          Agent live
        </span>
      </div>
      <div className="hl-lane-h">
        To do <span className="hl-count">4</span>
      </div>
      <div className="hl-ask">
        <div className="hl-ask-head">
          <Badge app="bot" ab="mb" />
          <div className="hl-row-text">
            <div className="hl-row-meta">mero-bot · This computer</div>
            <div className="hl-row-title">Bash: Render the album cover</div>
          </div>
          <span className="hl-pill hl-pill-wait">Needs you</span>
        </div>
        <div className="hl-code">{"$ mkdir -p ~/Pictures/cover && render cover.svg"}</div>
        <div className="hl-ask-actions">
          <span className="hl-fake hl-fake-primary">Approve</span>
          <span className="hl-fake">Decline</span>
          <span className="hl-ask-note">also waiting at the terminal</span>
        </div>
      </div>
      {todo.map((row, i) => (
        <Line key={i === 0 ? `new-${tick}` : row.title} row={row} tone="wait" fresh={i === 0 && tick > 0} />
      ))}
      <div className="hl-lane-h">
        In progress <span className="hl-count">2</span>
      </div>
      {PROGRESS.map((row) => (
        <Line key={row.title} row={row} tone="busy" />
      ))}
      <div className="hl-lane-h">
        Done <span className="hl-count">2</span>
        <span className="hl-lane-act">Archive all done</span>
      </div>
      {DONE.map((row) => (
        <Line key={row.title} row={row} tone="good" />
      ))}
    </div>
  );
}
