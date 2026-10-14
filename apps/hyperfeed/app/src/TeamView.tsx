import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeedItem } from "./generated/HyperfeedClient";
import type { Feed } from "./useFeed";
import { appLook } from "./apps";
import { laneOf, resolvable, timeLabel } from "./format";
import { AskAgent, Badge, Choices, LATER_MS, Resolver, RowBody, Status, turnShows } from "./FeedView";
import { agentDigest, digestLine, groupSentence, headlineOf, isNoise, teamGroups, type Headline, type TeamGroup } from "./team";

const appName = (key: string) => appLook(key).name;

/**
 * The feed as a team reads it.
 *
 * On top, what needs you, each with its buttons right on the card. Below,
 * what your team did around you, one card per subject however many updates
 * it had. Your agent's work is one digest card, not a row per step: you open
 * it when you want the detail. Reads your agent made never show.
 *
 * What you ask your agent, a card you discuss, and a row the bell points at
 * open here, under the ask box, as a row opens in Lanes: its answer, your
 * agent's turn, the flow and a box to say more. Chat is a click away.
 */
export function TeamView({
  feed,
  query,
  onChat,
  focus = "",
  onFocused,
}: {
  feed: Feed;
  query: string;
  /** Open a conversation in Chat; without it, nothing offers a way there. */
  onChat?: (chain: string) => void;
  /** A chain to open here once the feed has it, as the bell asks; "" for none. */
  focus?: string;
  onFocused?: () => void;
}) {
  const { page } = feed;
  const [open, setOpen] = useState<string | null>(null);
  const current = open ? ((page?.items ?? []).find((i) => i.chain === open) ?? null) : null;
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (current) panel.current?.scrollIntoView?.({ block: "nearest" });
  }, [current?.chain]);
  // Once per focus: then it closes as you like.
  const focused = useRef("");
  useEffect(() => {
    if (!focus) focused.current = "";
    if (!focus || !page || focused.current === focus) return;
    focused.current = focus;
    setOpen(focus);
    onFocused?.();
  }, [focus, page, onFocused]);
  const close = useCallback(() => setOpen(null), []);
  const items = useMemo(() => {
    const all = (page?.items ?? []).filter((i) => !isNoise(i));
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((i) => [i.title, i.body, i.from, i.source_label, appName(i.app)].join(" ").toLowerCase().includes(q));
  }, [page, query]);

  const needsYou = items.filter((i) => i.needs_you);
  const groups = useMemo(() => teamGroups(items, appName), [items]);
  const digest = useMemo(() => agentDigest(items), [items]);

  return (
    <main className="team">
      <AskAgent feed={feed} chain="" label="Ask your agent" onPosted={(m) => setOpen(m.chain)} />

      {current && (
        <section ref={panel} className="team-open" aria-label="Open conversation">
          <header className="team-head">
            <Sentence h={headlineOf(current, appName)} />
            <span className="grow" />
            {/* While your agent works, its turn below says so. */}
            {!turnShows(current) && <Status item={current} />}
            <button type="button" className="link small" onClick={close}>
              Close
            </button>
          </header>
          {/* What needs you is settled on its card below: here, the rest of it. */}
          <RowBody
            item={current}
            lane={laneOf(current)}
            card={current.needs_you}
            feed={feed}
            onChat={onChat}
            onArchive={(i) => {
              close();
              void feed.archive([i.chain]);
            }}
            onLater={(i) => {
              close();
              void feed.later(i.chain, Date.now() + LATER_MS, "Back in 3 hours");
            }}
          />
        </section>
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

      {page && (
        <>
          <section className="team-needs" aria-label="Needs you">
            <header className="team-head">
              <h2>Needs you</h2>
              <span className="lane-count">{needsYou.length}</span>
            </header>
            {needsYou.length === 0 ? (
              <p className="team-clear">You're clear. Nothing is waiting on you.</p>
            ) : (
              <ul className="team-cards">
                {needsYou.map((item) => (
                  <NeedsCard key={item.chain} item={item} feed={feed} onDiscuss={setOpen} />
                ))}
              </ul>
            )}
          </section>

          <div className="team-columns">
            <section className="team-activity" aria-label="Around you">
              <header className="team-head">
                <h2>Around you</h2>
              </header>
              {groups.length === 0 ? (
                <p className="lane-empty">Nothing from your team yet. Approve a lens in Settings → Lenses and their mentions, assignments and polls show here.</p>
              ) : (
                <ul className="team-posts">
                  {groups.map((g) => (
                    <GroupPost key={g.key} group={g} />
                  ))}
                </ul>
              )}
            </section>

            <AgentCard items={digest.items} line={digestLine(digest)} onOpen={setOpen} />
          </div>
        </>
      )}
    </main>
  );
}

function Face({ initials, title, agent }: { initials: string; title: string; agent?: boolean }) {
  return (
    <span className={`face${agent ? " face-agent" : ""}`} title={title} aria-hidden="true">
      {initials}
    </span>
  );
}

function Sentence({ h }: { h: Headline }) {
  return (
    <span className="team-sentence">
      <strong>{h.who}</strong> {h.verb}
      {h.object && <span className="team-object">{h.object}</span>}
    </span>
  );
}

/** One thing that needs you, with everything it takes to settle it right on the card. */
function NeedsCard({ item, feed, onDiscuss }: { item: FeedItem; feed: Feed; onDiscuss: (chain: string) => void }) {
  const h = headlineOf(item, appName);
  return (
    <li className="team-card">
      <div className="team-card-head">
        <Face initials={h.initials} title={h.who} agent={!h.person} />
        <Sentence h={h} />
        <Status item={item} />
      </div>
      <div className="team-card-where">
        <Badge app={item.app || "hyperfeed"} size="sm" />
        {appName(item.app || "hyperfeed")}
        {item.source_label ? ` · ${item.source_label}` : ""} · {timeLabel(item.chain_at || item.at)}
      </div>
      {resolvable(item) && <Resolver key={item.id} item={item} feed={feed} />}
      <div className="actions">
        <Choices item={item} busy={feed.busy} onDecide={(d) => void feed.resolve(item.id, d)} />
        <span className="grow" />
        <button type="button" className="ghost small" onClick={() => onDiscuss(item.chain)}>
          Discuss
        </button>
        <button
          type="button"
          className="ghost small"
          disabled={feed.busy}
          onClick={() => void feed.later(item.chain, Date.now() + LATER_MS, "Back in 3 hours")}
        >
          Later
        </button>
      </div>
    </li>
  );
}

/** What your team did on one subject: the faces, the newest update, and how many more. */
function GroupPost({ group }: { group: TeamGroup }) {
  const [open, setOpen] = useState(false);
  const lead = group.items[0]!;
  const h = groupSentence(group, appName);
  const more = group.items.length - 1;
  return (
    <li className="team-post">
      <div className="team-faces">
        {(group.people.length ? group.people : [{ name: h.who, initials: h.initials }]).slice(0, 3).map((p) => (
          <Face key={p.name} initials={p.initials} title={p.name} />
        ))}
      </div>
      <div className="team-post-body">
        <Sentence h={h} />
        <span className="team-card-where">
          <Badge app={group.app} size="sm" />
          {appName(group.app)}
          {lead.source_label ? ` · ${lead.source_label}` : ""} · {timeLabel(group.at)}
        </span>
        {more > 0 && (
          <button type="button" className="link small" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? "Hide updates" : `Show all ${group.items.length}`}
          </button>
        )}
        {open && (
          <ul className="team-updates">
            {group.items.map((i) => {
              const u = headlineOf(i, appName);
              return (
                <li key={i.id}>
                  <strong>{u.who}</strong> {u.verb} · <span className="muted">{timeLabel(i.chain_at || i.at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </li>
  );
}

/** Your agent's day as one card; open it for the list. */
function AgentCard({ items, line, onOpen }: { items: FeedItem[]; line: string; onOpen: (chain: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="team-agent" aria-label="Your agent today">
      <header className="team-head">
        <Face initials="AI" title="Your agent" agent />
        <h2>Your agent today</h2>
      </header>
      <p className="team-digest">{line}</p>
      {items.length > 0 && (
        <button type="button" className="link small" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : `See all ${items.length}`}
        </button>
      )}
      {open && (
        <ul className="team-agent-list">
          {items.map((i) => {
            const h = headlineOf(i, appName);
            return (
              <li key={i.chain}>
                <button type="button" className="link" onClick={() => onOpen(i.chain)}>
                  {h.object || i.title}
                </button>
                <Status item={i} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
