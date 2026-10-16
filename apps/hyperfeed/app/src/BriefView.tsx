import { useEffect, useMemo, useState } from "react";
import type { FeedItem } from "./generated/HyperfeedClient";
import type { Feed } from "./useFeed";
import { appLook } from "./apps";
import { choicesFor, flowOf, previewOf, progressLine, resolvable, timeLabel, type FlowStep } from "./format";
import { AskAgent, Badge, Choices, LATER_MS, Resolver, Status } from "./FeedView";
import { briefOf, greeting, recommendationOf, reversibility, statusLine, summaryLine, whyShown } from "./brief";
import { headlineOf } from "./team";

const appName = (key: string) => appLook(key).name;

/**
 * The feed as a brief: your agent manages it, you take in what matters and act.
 *
 * On top, one line on how things stand. Then the few decisions only you can
 * make, most pressing first, each with what happened, what your agent
 * recommends, why it reached you and the evidence behind it, settled right on
 * the card; the rest wait behind "more". Below, what is moving, and what was
 * handled without you, folded away with its undo. An empty brief is the goal.
 */
export function BriefView({ feed, query, onChat }: { feed: Feed; query: string; onChat?: (chain: string) => void }) {
  const { page } = feed;
  const items = useMemo(() => {
    const all = page?.items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((i) => [i.title, i.body, i.from, i.source_label, appName(i.app)].join(" ").toLowerCase().includes(q));
  }, [page, query]);
  const brief = useMemo(() => briefOf(items), [items]);
  const [showHeld, setShowHeld] = useState(false);
  const [showHandled, setShowHandled] = useState(false);
  const calm = brief.decisions.length === 0 && brief.moving.length === 0;

  return (
    <main className="brief">
      <section className={`brief-hud${calm ? " calm" : ""}`} aria-label="How things stand">
        <span className="brief-pulse" aria-hidden="true" />
        <span className="brief-status">{statusLine(brief)}</span>
      </section>

      {feed.error && (
        <div className="error" role="alert">
          <span>{feed.error}</span>
          <button type="button" className="ghost small" onClick={feed.dismissError}>
            Dismiss
          </button>
        </div>
      )}
      {!page && !feed.error && <div className="empty">Loading the feed…</div>}

      {page && (
        <>
          <header className="brief-intro">
            <h1>{greeting()}.</h1>
            <p>{summaryLine(brief)}</p>
          </header>

          <section className="brief-decisions" aria-label="Decisions for you">
            {brief.decisions.length === 0 ? (
              <p className="brief-clear">You're clear. Your agent will bring you anything that needs a person.</p>
            ) : (
              <ol className="brief-cards">
                {(showHeld ? brief.decisions : brief.shown).map((item, n) => (
                  <DecisionCard key={item.chain} item={item} rank={n + 1} feed={feed} onChat={onChat} />
                ))}
              </ol>
            )}
            {brief.held.length > 0 && (
              <button type="button" className="link small brief-more" aria-expanded={showHeld} onClick={() => setShowHeld((v) => !v)}>
                {showHeld ? "Show only the most pressing" : `${brief.held.length} more, less pressing`}
              </button>
            )}
          </section>

          <AskAgent feed={feed} chain="" label="Ask your agent" />

          {brief.moving.length > 0 && (
            <section className="brief-section" aria-label="In motion">
              <h2>In motion</h2>
              <ul className="brief-lines">
                {brief.moving.map((item) => (
                  <BriefLine key={item.chain} item={item} detail={progressLine(item)} onChat={onChat} />
                ))}
              </ul>
            </section>
          )}

          <section className="brief-section brief-handled" aria-label="Handled quietly">
            <button type="button" className="brief-fold" aria-expanded={showHandled} onClick={() => setShowHandled((v) => !v)}>
              <h2>Handled quietly</h2>
              <span className="lane-count">{brief.handled.length}</span>
              <span className="grow" />
              <span className="muted small">{showHandled ? "Hide" : brief.handled.length ? "Show" : ""}</span>
            </button>
            {showHandled &&
              (brief.handled.length === 0 ? (
                <p className="lane-empty">Nothing yet today.</p>
              ) : (
                <ul className="brief-lines">
                  {brief.handled.map((item) => (
                    <BriefLine key={item.chain} item={item} feed={feed} onChat={onChat} />
                  ))}
                </ul>
              ))}
          </section>
        </>
      )}
    </main>
  );
}

/** One decision: what happened, what your agent recommends, why it is yours, and its buttons. */
function DecisionCard({ item, rank, feed, onChat }: { item: FeedItem; rank: number; feed: Feed; onChat?: (chain: string) => void }) {
  const [why, setWhy] = useState(false);
  const [evidence, setEvidence] = useState(false);
  const h = headlineOf(item, appName);
  const situation = item.body ? previewOf(item.body, 3, 320) : "";
  const recommends = recommendationOf(item);
  const rev = reversibility(item);
  const tone = item.breach || item.category || item.status === "failed" ? "hot" : "";
  return (
    <li className={`brief-card ${tone}`}>
      <div className="brief-card-head">
        <span className="brief-rank" aria-label={`Number ${rank}`}>
          {rank}
        </span>
        <div className="brief-card-title">
          <span className="team-sentence">
            <strong>{h.who}</strong> {h.verb}
            {h.object && <span className="team-object">{h.object}</span>}
          </span>
          <span className="team-card-where">
            <Badge app={item.app || "hyperfeed"} size="sm" />
            {appName(item.app || "hyperfeed")}
            {item.source_label ? ` · ${item.source_label}` : ""} · {timeLabel(item.chain_at || item.at)}
          </span>
        </div>
        <Status item={item} />
      </div>

      {situation && <p className="brief-situation">{situation}</p>}
      {recommends && (
        <div className="brief-recommend">
          <span className="brief-label">{recommends.label}</span>
          <span>{recommends.text}</span>
        </div>
      )}
      {rev && <span className={`brief-rev ${rev}`}>{rev === "undoable" ? "Can be undone" : "Can't be undone"}</span>}

      {resolvable(item) && <Resolver key={item.id} item={item} feed={feed} />}
      <div className="actions">
        <Choices item={item} busy={feed.busy} onDecide={(d) => void feed.resolve(item.id, d)} />
        <span className="grow" />
        <button type="button" className="link small" aria-expanded={why} onClick={() => setWhy((v) => !v)}>
          Why me?
        </button>
        <button type="button" className="link small" aria-expanded={evidence} onClick={() => setEvidence((v) => !v)}>
          Evidence{item.chain_len > 1 ? ` (${item.chain_len})` : ""}
        </button>
        {onChat && (
          <button type="button" className="ghost small" onClick={() => onChat(item.chain)}>
            Discuss
          </button>
        )}
        <button
          type="button"
          className="ghost small"
          disabled={feed.busy}
          onClick={() => void feed.later(item.chain, Date.now() + LATER_MS, "Back in 3 hours")}
        >
          Later
        </button>
      </div>
      {why && <p className="brief-why">{whyShown(item, appName)}</p>}
      {evidence && <Evidence chain={item.chain} feed={feed} />}
    </li>
  );
}

/** Everything in the chain that led here, oldest first: who did what, when. */
function Evidence({ chain, feed }: { chain: string; feed: Feed }) {
  const [steps, setSteps] = useState<FlowStep[] | null>(null);
  useEffect(() => {
    let live = true;
    void feed
      .loadChain(chain)
      .then((rows) => live && setSteps(flowOf(rows, appName)))
      .catch(() => live && setSteps([]));
    return () => {
      live = false;
    };
  }, [chain, feed]);
  if (!steps) return <p className="muted small">Loading…</p>;
  if (steps.length === 0) return <p className="muted small">Nothing more to show.</p>;
  return (
    <ol className="brief-evidence" aria-label="Evidence">
      {steps.map((s) => (
        <li key={s.key} className={`tone-${s.tone}`}>
          <span className="brief-ev-who">{s.who}</span>
          <span className="brief-ev-text">{s.text}</span>
          <span className="muted small">{timeLabel(s.at)}</span>
        </li>
      ))}
    </ol>
  );
}

/** One line in "In motion" or "Handled quietly": what it was, where it stands, and its undo when it has one. */
function BriefLine({ item, detail = "", feed, onChat }: { item: FeedItem; detail?: string; feed?: Feed; onChat?: (chain: string) => void }) {
  const h = headlineOf(item, appName);
  const undo = feed && choicesFor(item).undo;
  return (
    <li className="brief-line">
      <Badge app={item.app || "hyperfeed"} size="sm" />
      <span className="brief-line-text">
        {onChat ? (
          <button type="button" className="link" onClick={() => onChat(item.chain)}>
            {h.object || item.title}
          </button>
        ) : (
          h.object || item.title
        )}
        {detail && <span className="muted small"> · {detail}</span>}
      </span>
      <span className="muted small">{timeLabel(item.chain_at || item.at)}</span>
      <Status item={item} />
      {undo && (
        <button type="button" className="ghost small" disabled={feed.busy} onClick={() => void feed.resolve(item.id, "undo")}>
          Undo
        </button>
      )}
    </li>
  );
}
