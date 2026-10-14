import { useEffect, useRef, useState } from "react";
import type { FeedItem, LensView } from "./generated/HyperfeedClient";
import type { Feed } from "./useFeed";
import type { Attention } from "./useAttention";
import { appLook } from "./apps";
import { alertOf } from "./attention";
import { localCommand, timeLabel } from "./format";

const appName = (key: string) => appLook(key).name;

/** What waits on you in Settings: lenses your agent proposed, and rules it suggested. */
export function settingsWaiting(feed: Feed): { lenses: LensView[]; rules: number } {
  return { lenses: feed.lenses.filter((l) => l.status === "proposed"), rules: feed.settings?.rule_proposals?.length ?? 0 };
}

/** Everything the bell counts: the feed's chains waiting on you, and what waits in Settings. */
export function waitingCount(feed: Feed | null): number {
  if (!feed) return 0;
  const s = settingsWaiting(feed);
  return (feed.page?.counts.needs_you ?? 0) + s.lenses.length + s.rules;
}

/**
 * What needs you, behind the bell: every chain waiting on you (your agent's
 * question, an approval, an app flagging you), whatever the feed shows, and
 * what waits in Settings (a lens or a rule your agent proposed). Each is one
 * line; a click opens it where it is answered.
 * Whether a banner says so when you look elsewhere is switched here too.
 */
export function NeedsYou({
  feed,
  attention,
  onOpen,
  onSettings,
  onClose,
}: {
  feed: Feed;
  attention: Attention;
  /** Open a row where the rest of it is: its chat, or the feed. */
  onOpen: (item: FeedItem) => void;
  /** Open a section of Settings: "lenses", "rules". */
  onSettings: (section: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const { needsYou, page } = feed;
  // Read again with the feed, which follows every event on it.
  useEffect(() => {
    let live = true;
    void needsYou().then((i) => live && setItems(i), () => live && setItems([]));
    return () => {
      live = false;
    };
  }, [needsYou, page]);

  const { lenses, rules } = settingsWaiting(feed);
  const proposals = feed.settings?.rule_proposals ?? [];
  const nothing = items !== null && items.length === 0 && lenses.length === 0 && rules === 0;

  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const click = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (panel.current && t && !panel.current.contains(t) && !t.closest?.(".needs-bell")) onClose();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", click);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", click);
    };
  }, [onClose]);

  return (
    <div ref={panel} className="needs-panel" role="dialog" aria-label="Needs you">
      <div className="needs-panel-head">
        <h2>Needs you</h2>
        {attention.supported && (
          <button type="button" className="link small" aria-pressed={attention.on} onClick={() => void attention.toggle()}>
            {attention.on ? "Alerts on" : "Alert me"}
          </button>
        )}
      </div>
      {attention.blocked && (
        <p className="needs-panel-note">Alerts are blocked for this site: allow notifications in your browser's settings.</p>
      )}
      {nothing ? (
        <p className="needs-panel-note">Nothing needs you.</p>
      ) : items === null ? (
        <p className="needs-panel-note">Loading…</p>
      ) : (
        items.length > 0 && (
          <>
            {(lenses.length > 0 || proposals.length > 0) && <h3 className="needs-panel-sub">In your feed</h3>}
            <ul className="needs-panel-list" aria-label="In your feed">
              {items.map((i) => (
                <SummaryRow key={i.chain} {...summaryOf(i)} at={i.chain_at || i.at} onOpen={() => onOpen(i)} />
              ))}
            </ul>
          </>
        )
      )}
      {(lenses.length > 0 || proposals.length > 0) && (
        <>
          <h3 className="needs-panel-sub">In Settings</h3>
          <ul className="needs-panel-list" aria-label="In Settings">
            {lenses.map((l) => (
              <SummaryRow
                key={`${l.app}:${l.application_id}`}
                title={`${appName(l.app)}: a lens to approve`}
                body={l.summary}
                at={l.updated_at}
                onOpen={() => onSettings("lenses")}
              />
            ))}
            {proposals.map((p) => (
              <SummaryRow key={p.id} title="A rule your agent suggests" body={p.text} at={p.created_at} onOpen={() => onSettings("rules")} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function summaryOf(item: FeedItem): { title: string; body: string } {
  const a = alertOf(item, appName);
  return { title: a.title, body: a.body };
}

/** One thing waiting on you, as a line: what it is, a word on it, and when. A click opens it where its buttons are. */
function SummaryRow({ title, body, at, onOpen }: { title: string; body: string; at: number; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className="needs-panel-row" onClick={onOpen}>
        <span className="needs-panel-what">
          <strong>{title}</strong>
          <span className="needs-panel-time">{timeLabel(at)}</span>
        </span>
        {body && <span className="needs-panel-body">{body}</span>}
      </button>
    </li>
  );
}

/**
 * Where a row opens: your agent's question, and a command on your computer it
 * asked about in a chat, in that chat; anything else in the feed, whose
 * "Needs you" strip carries its buttons.
 */
export function opensIn(item: FeedItem): "chat" | "feed" {
  return item.kind === "message" || localCommand(item) ? "chat" : "feed";
}
