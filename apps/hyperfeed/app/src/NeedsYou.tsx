import { useEffect, useRef, useState } from "react";
import type { FeedItem, LensView } from "./generated/HyperfeedClient";
import type { Feed } from "./useFeed";
import type { Attention } from "./useAttention";
import { appLook } from "./apps";
import { alertOf } from "./attention";
import { choicesFor, resolvable, timeLabel } from "./format";
import { Choices, Resolver } from "./FeedView";
import { RuleSuggestion } from "./SettingsView";

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
 * what waits in Settings (a lens or a rule your agent proposed), each with
 * its buttons so it is settled from here, and Open for the rest of it.
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
                <NeedsRow key={i.chain} item={i} feed={feed} onOpen={() => onOpen(i)} />
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
              <LensRow key={`${l.app}:${l.application_id}`} lens={l} feed={feed} onOpen={() => onSettings("lenses")} />
            ))}
            {proposals.map((p) => (
              <RuleSuggestion key={p.id} proposal={p} feed={feed} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function NeedsRow({ item, feed, onOpen }: { item: FeedItem; feed: Feed; onOpen: () => void }) {
  const a = alertOf(item, appName);
  const c = choicesFor(item);
  return (
    <li className="needs-panel-row">
      <div className="needs-panel-what">
        <strong>{a.title}</strong>
        <span className="needs-panel-time">{timeLabel(item.chain_at || item.at)}</span>
      </div>
      {a.body && <p className="needs-panel-body">{a.body}</p>}
      {resolvable(item) && <Resolver key={item.id} item={item} feed={feed} />}
      <div className="actions">
        {(c.approve || c.decline || c.keep || c.undo) && (
          <Choices item={item} busy={feed.busy} onDecide={(d) => void feed.resolve(item.id, d)} />
        )}
        <button type="button" className="ghost small" onClick={onOpen}>
          Open
        </button>
      </div>
    </li>
  );
}

/** A lens your agent proposed for an app: what your feed would read from it, yours to approve. */
function LensRow({ lens, feed, onOpen }: { lens: LensView; feed: Feed; onOpen: () => void }) {
  return (
    <li className="needs-panel-row" aria-label={`Lens for ${appName(lens.app)}`}>
      <div className="needs-panel-what">
        <strong>{appName(lens.app)}: approve what your feed reads?</strong>
        <span className="needs-panel-time">{timeLabel(lens.updated_at)}</span>
      </div>
      {lens.summary && <p className="needs-panel-body">{lens.summary}</p>}
      <div className="actions">
        <button type="button" className="primary small" disabled={feed.busy} onClick={() => void feed.decideLens(lens.app, lens.application_id, "approve")}>
          Approve
        </button>
        <button type="button" className="ghost small" disabled={feed.busy} onClick={() => void feed.decideLens(lens.app, lens.application_id, "reject")}>
          Turn down
        </button>
        <button type="button" className="ghost small" onClick={onOpen}>
          Open
        </button>
      </div>
    </li>
  );
}

/** Where Open takes a row: an app's notification to the feed; your agent's question or action to its chat. */
export function opensIn(item: FeedItem): "chat" | "feed" {
  return item.kind === "notification" ? "feed" : "chat";
}
