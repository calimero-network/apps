import { useEffect, useMemo, useRef, useState } from "react";
import type { AutorunView, FeedItem, LinkView, SituationView } from "./generated/HyperfeedClient";
import type { Feed } from "./useFeed";
import { appLook } from "./apps";
import { choicesFor, flowOf, previewOf, progressLine, resolvable, timeLabel, type FlowStep } from "./format";
import { AskAgent, Badge, Choices, LATER_MS, Resolver, Status } from "./FeedView";
import {
  allowOffer,
  autorunLine,
  briefOf,
  greeting,
  pressLine,
  recommendationOf,
  reversibility,
  sinceLine,
  statusLine,
  summaryLine,
  tuneRule,
  waitingAutoruns,
  whyShown,
  type FilteredGroup,
} from "./brief";
import { digestSince, headlineOf } from "./team";
import { touchVisit } from "./visit";

const appName = (key: string) => appLook(key).name;

/** How many rows "Done for you" lists before "Show all". */
const DONE_SHOWN = 5;

/**
 * The feed as a brief: your agent manages it, you take in what matters and act.
 *
 * On top, one line on how things stand since you were last here. Then the few
 * decisions only you can make, most pressing first, each with what happened,
 * your agent's case, why it reached you and the evidence behind it, settled
 * right on the card; the rest wait behind "more". Below, what is moving, what
 * your agent did for you (with its undo), and what was filtered out because
 * it did not need you, which you can look into and tune. An empty brief is
 * the goal.
 */
export function BriefView({
  feed,
  query,
  onChat,
  feedKey = "",
  focus = "",
  onFocused,
}: {
  feed: Feed;
  query: string;
  onChat?: (chain: string) => void;
  /** Which feed this is, so your last visit is kept per feed; "" in the demo. */
  feedKey?: string;
  /** A chain the bell points at: its card is brought into view, held back or not; "" for none. */
  focus?: string;
  onFocused?: () => void;
}) {
  const { page } = feed;
  // Where "since" starts: the end of your last visit on this device, read once.
  const [lastVisit] = useState(() => touchVisit(feedKey));
  useEffect(() => {
    const id = window.setInterval(() => touchVisit(feedKey), 60_000);
    return () => window.clearInterval(id);
  }, [feedKey]);
  const items = useMemo(() => {
    const all = page?.items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((i) => [i.title, i.body, i.from, i.source_label, appName(i.app)].join(" ").toLowerCase().includes(q));
  }, [page, query]);
  const now = Date.now();
  const since = lastVisit || digestSince(now);
  const situations = useMemo(() => new Map(feed.situations.map((v) => [v.chain, v])), [feed.situations]);
  const autoruns = useMemo(() => waitingAutoruns(feed.autoruns), [feed.autoruns]);
  const brief = useMemo(() => briefOf(items, Date.now(), since, appName, situations), [items, since, situations]);
  const going = brief.decisions.filter((i) => autoruns.has(i.id)).length;
  const [showHeld, setShowHeld] = useState(false);
  const calm = brief.decisions.length === 0 && brief.moving.length === 0;
  // Once per focus: show it even when it was held back, then bring it into view.
  const [focused, setFocused] = useState("");
  const handled = useRef("");
  useEffect(() => {
    if (!focus) handled.current = "";
    if (!focus || !page || handled.current === focus) return;
    handled.current = focus;
    setFocused(focus);
    onFocused?.();
  }, [focus, page, onFocused]);
  // A held-back card the bell pointed at shows with the rest of them.
  const expanded = showHeld || brief.held.some((i) => i.chain === focused);

  return (
    <main className="brief">
      <section className="brief-top" aria-label="How things stand">
        <span className={`brief-hud${calm ? " calm" : ""}`}>
          <span className="brief-pulse" aria-hidden="true" />
          <span className="brief-status">{statusLine(brief)}</span>
        </span>
        <span className="brief-since">{sinceLine(since, lastVisit > 0, now)}</span>
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
            <h1>{greeting(now)}.</h1>
            <p>{summaryLine(brief, lastVisit > 0, now, going, situations)}</p>
          </header>

          <section className="brief-decisions" aria-label="Decisions for you">
            {brief.decisions.length === 0 ? (
              <p className="brief-clear">You're clear. Your agent will bring you anything that needs a person.</p>
            ) : (
              <ol className="brief-cards">
                {(expanded ? brief.decisions : brief.shown).map((item, n) => (
                  <DecisionCard
                    key={item.chain}
                    item={item}
                    rank={n + 1}
                    feed={feed}
                    items={page.items}
                    situation={situations.get(item.chain)}
                    autorun={autoruns.get(item.id)}
                    focused={focused === item.chain}
                    onChat={onChat}
                  />
                ))}
              </ol>
            )}
            {brief.held.length > 0 && (
              <button
                type="button"
                className="link small brief-more"
                aria-expanded={expanded}
                onClick={() => {
                  setFocused("");
                  setShowHeld(!expanded);
                }}
              >
                {expanded ? "Show only the most pressing" : `${brief.held.length} more, less pressing`}
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

          <div className="brief-handled">
            <DoneForYou items={brief.done} undoable={brief.undoable} feed={feed} onChat={onChat} />
            <FilteredOut groups={brief.filtered} count={brief.filteredCount} feed={feed} />
          </div>
        </>
      )}
    </main>
  );
}

/** One decision: what happened, your agent's case, why it is yours, its buttons, and its evidence. */
function DecisionCard({
  item,
  rank,
  feed,
  items,
  situation,
  autorun,
  focused = false,
  onChat,
}: {
  item: FeedItem;
  rank: number;
  feed: Feed;
  /** Every row on the page: what "Always allow" counts, and what Evidence finds around it. */
  items: FeedItem[];
  /** The chain told as one card by your agent, when it wrote one. */
  situation?: SituationView;
  /** When it goes ahead by itself unless you stop it. */
  autorun?: AutorunView;
  /** The bell pointed at it: bring it into view, marked. */
  focused?: boolean;
  onChat?: (chain: string) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: "center" });
  }, [focused]);
  const [why, setWhy] = useState(false);
  const [evidence, setEvidence] = useState(false);
  const [keepAsking, setKeepAsking] = useState(false);
  const h = headlineOf(item, appName);
  const told = situation?.summary || (item.body ? previewOf(item.body, 3, 320) : "");
  const recommends = situation?.recommend ? { label: "Your agent recommends", text: situation.recommend } : recommendationOf(item);
  const rev = reversibility(item);
  const press = pressLine(item, Date.now(), situation);
  const going = autorun ? autorunLine(autorun) : null;
  const hot = Boolean(item.breach || item.category || item.status === "failed" || press?.hot);
  const offer = !keepAsking && feed.setActionMode ? allowOffer(item, items, feed.actionSets, feed.settings) : null;
  return (
    <li ref={ref} className={`brief-card${hot ? " hot" : ""}${focused ? " focused" : ""}`}>
      <div className="brief-card-head">
        <span className="brief-rank" aria-label={`Number ${rank}`}>
          {rank}
        </span>
        <div className="brief-card-title">
          {situation ? (
            <>
              <h3 className="brief-headline">{situation.headline}</h3>
              {situation.sources > 0 && (
                <span className="muted small">
                  Written by your agent from {situation.sources} {situation.sources === 1 ? "thing" : "things"}
                  {situation.apps > 1 ? ` in ${situation.apps} apps` : ""}
                </span>
              )}
            </>
          ) : (
            <span className="team-sentence">
              <strong>{h.who}</strong> {h.verb}
              {h.object && <span className="team-object">{h.object}</span>}
            </span>
          )}
          <span className="team-card-where">
            <Badge app={item.app || "hyperfeed"} size="sm" />
            {appName(item.app || "hyperfeed")}
            {item.source_label ? ` · ${item.source_label}` : ""} · {timeLabel(item.chain_at || item.at)}
          </span>
        </div>
        <div className="brief-card-pills">
          {going && <span className="pill pill-busy">{going.pill}</span>}
          {press && <span className={`pill ${press.hot ? "pill-bad" : "pill-wait"}`}>{press.text}</span>}
          <Status item={item} />
        </div>
      </div>

      {situation && (
        <p className="brief-about muted small">About: {h.verb ? `${h.who} ${h.verb}${h.object ? ` ${h.object}` : ""}` : h.object}</p>
      )}
      {told && <p className="brief-situation">{told}</p>}
      {recommends && (
        <div className="brief-recommend">
          <span className="brief-label">{recommends.label}</span>
          <span>{recommends.text}</span>
        </div>
      )}
      {rev && <span className={`brief-rev ${rev}`}>{rev === "undoable" ? "Can be undone" : "Can't be undone"}</span>}
      {going && autorun && (
        <div className="brief-autorun" role="group" aria-label="Goes ahead by itself">
          <div className="brief-autorun-line">
            <span>{going.line}</span>
            {feed.stopAutorun && (
              <button type="button" className="ghost small" disabled={feed.busy} onClick={() => void feed.stopAutorun?.(autorun.id)}>
                Stop it
              </button>
            )}
          </div>
          <div className="brief-bar" aria-hidden="true">
            <span style={{ width: `${Math.round(going.progress * 100)}%` }} />
          </div>
        </div>
      )}

      {resolvable(item) && <Resolver key={item.id} item={item} feed={feed} />}
      <div className="actions">
        <Choices item={item} busy={feed.busy} onDecide={(d) => void feed.resolve(item.id, d)} />
        <span className="grow" />
        <button type="button" className="link small" aria-expanded={why} onClick={() => setWhy((v) => !v)}>
          Why me?
        </button>
        <button type="button" className="link small" aria-expanded={evidence} onClick={() => setEvidence((v) => !v)}>
          {evidence ? "Hide evidence" : `Evidence${item.chain_len > 1 ? ` (${item.chain_len})` : ""}`}
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
      {why && <p className="brief-why">{whyShown(item, appName, Date.now(), situation)}</p>}
      {evidence && <Evidence item={item} feed={feed} items={items} />}
      {offer && (
        <div className="brief-allow" role="group" aria-label="Stop asking for this">
          <div className="brief-allow-text">
            <strong>
              You approved {offer.approved} of {offer.approved} like this one this week.
            </strong>
            <span>
              Let your agent “{offer.label}” in {appName(offer.app)} without asking? Signing, money and the other guards still come to you.
            </span>
          </div>
          <button
            type="button"
            className="ghost small"
            disabled={feed.busy}
            onClick={() => void feed.setActionMode?.(offer.app, offer.action, "act")}
          >
            Always allow
          </button>
          <button type="button" className="link small" onClick={() => setKeepAsking(true)}>
            Keep asking
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * The evidence behind a decision: every step in its chain, oldest first, and
 * beside it what your team did on the things the task links to (a chat, an
 * issue, a doc), newest first.
 */
function Evidence({ item, feed, items }: { item: FeedItem; feed: Feed; items: FeedItem[] }) {
  const [rows, setRows] = useState<FeedItem[] | null>(null);
  const [links, setLinks] = useState<LinkView[]>([]);
  useEffect(() => {
    let live = true;
    void feed
      .loadChain(item.chain)
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    void (feed.loadLinks?.(item.chain) ?? Promise.resolve([]))
      .then((l) => live && setLinks(l))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [item.chain, feed]);
  const steps: FlowStep[] | null = useMemo(() => (rows ? flowOf(rows, appName) : null), [rows]);
  const around = useMemo(() => aroundOf(item, links, items, rows ?? []), [item, links, items, rows]);
  if (!steps) return <p className="muted small">Loading…</p>;
  return (
    <div className="brief-evidence" aria-label="Evidence" role="group">
      <div>
        <span className="brief-label muted">In this task</span>
        {steps.length === 0 ? (
          <p className="muted small">Nothing more to show.</p>
        ) : (
          <ol aria-label="In this task">
            {steps.map((s) => (
              <li key={s.key}>
                <span className="muted small">{timeLabel(s.at)}</span>
                <span>
                  <strong>{s.who}</strong> {s.text}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {around.length > 0 && (
        <div>
          <span className="brief-label muted">Around it, from your team</span>
          <ol aria-label="Around it, from your team">
            {around.map((i) => {
              const h = headlineOf(i, appName);
              return (
                <li key={i.id}>
                  <span className="muted small">{timeLabel(i.chain_at || i.at)}</span>
                  <span>
                    <strong>{h.who}</strong> {h.verb}
                    {h.object ? `: ${h.object}` : ""}
                    {i.source_label ? <span className="muted"> · {i.source_label}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

/** How many teammates' updates Evidence shows beside a task. */
const AROUND_SHOWN = 5;

/**
 * What your team did, outside this chain, where the task is: the contexts it
 * links to, and those its own rows came from (the chat a mention was in).
 * Newest first.
 */
export function aroundOf(item: FeedItem, links: LinkView[], items: FeedItem[], chain: FeedItem[] = []): FeedItem[] {
  const where = new Set(links.map((l) => `${l.app}\u0000${l.context}`));
  for (const r of [item, ...chain]) if (r.source_context) where.add(`${r.app}\u0000${r.source_context}`);
  return items
    .filter((i) => i.chain !== item.chain && i.kind === "notification" && where.has(`${i.app}\u0000${i.source_context}`))
    .sort((a, b) => (b.chain_at || b.at) - (a.chain_at || a.at))
    .slice(0, AROUND_SHOWN);
}

/** What your agent did for you since you were last here, with its undo. */
function DoneForYou({ items, undoable, feed, onChat }: { items: FeedItem[]; undoable: number; feed: Feed; onChat?: (chain: string) => void }) {
  const [all, setAll] = useState(false);
  return (
    <section className="brief-panel" aria-label="Done for you">
      <header className="brief-panel-head">
        <h2>Done for you</h2>
        <span className="lane-count">{items.length}</span>
        <span className="grow" />
        {undoable > 0 && <span className="muted small">{undoable} can still be undone</span>}
      </header>
      {items.length === 0 ? (
        <p className="lane-empty">Nothing yet.</p>
      ) : (
        <ul className="brief-lines">
          {(all ? items : items.slice(0, DONE_SHOWN)).map((item) => (
            <BriefLine key={item.chain} item={item} feed={feed} onChat={onChat} />
          ))}
        </ul>
      )}
      {items.length > DONE_SHOWN && (
        <button type="button" className="link small" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}

/**
 * Notifications that did not need you, by where they came from. Show me
 * opens one source's list; Less like this and More like this become rules
 * your agent keeps, which you see and change in Settings → Rules.
 */
function FilteredOut({ groups, count, feed }: { groups: FilteredGroup[]; count: number; feed: Feed }) {
  const [open, setOpen] = useState<string | null>(null);
  const [tuned, setTuned] = useState<Record<string, "more" | "less">>({});
  const tune = async (g: FilteredGroup, more: boolean) => {
    await feed.addRule(tuneRule(g, more, appName));
    setTuned((t) => ({ ...t, [g.key]: more ? "more" : "less" }));
  };
  return (
    <section className="brief-panel" aria-label="Filtered out">
      <header className="brief-panel-head">
        <h2>Filtered out</h2>
        <span className="lane-count">{count}</span>
        <span className="grow" />
        <span className="muted small">nothing here needed you</span>
      </header>
      {groups.length === 0 ? (
        <p className="lane-empty">Nothing filtered out.</p>
      ) : (
        <ul className="brief-groups">
          {groups.map((g) => (
            <li key={g.key}>
              <div className="brief-group-line">
                <Badge app={g.app || "hyperfeed"} size="sm" />
                <span className="brief-line-text">
                  {g.items.length} {g.items.length === 1 ? "update" : "updates"} in {g.where}
                </span>
                <button type="button" className="link small" aria-expanded={open === g.key} onClick={() => setOpen((o) => (o === g.key ? null : g.key))}>
                  {open === g.key ? "Hide" : "Show me"}
                </button>
                {tuned[g.key] ? (
                  <span className="muted small">{tuned[g.key] === "more" ? "You'll get more like this" : "You'll get fewer like this"}</span>
                ) : (
                  <>
                    <button type="button" className="ghost small" disabled={feed.busy} onClick={() => void tune(g, false)}>
                      Less like this
                    </button>
                    <button type="button" className="ghost small" disabled={feed.busy} onClick={() => void tune(g, true)}>
                      More like this
                    </button>
                  </>
                )}
              </div>
              {open === g.key && (
                <ul className="brief-lines brief-group-items">
                  {g.items.map((item) => (
                    <BriefLine key={item.id} item={item} />
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Less like this and More like this become rules you can see and change in Settings → Rules.</p>
    </section>
  );
}

/** One line in a list: what it was, where it stands, and its undo when it has one. */
function BriefLine({ item, detail = "", feed, onChat }: { item: FeedItem; detail?: string; feed?: Feed; onChat?: (chain: string) => void }) {
  const h = headlineOf(item, appName);
  const what = item.kind === "notification" ? `${h.who} ${h.verb}${h.object ? `: ${h.object}` : ""}` : h.object || item.title;
  const undo = feed && choicesFor(item).undo;
  return (
    <li className="brief-line">
      <Badge app={item.app || "hyperfeed"} size="sm" />
      <span className="brief-line-text">
        {onChat ? (
          <button type="button" className="link" onClick={() => onChat(item.chain)}>
            {what}
          </button>
        ) : (
          what
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
