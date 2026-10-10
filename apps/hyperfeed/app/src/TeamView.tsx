import { useMemo, useState } from "react";
import type { FeedItem } from "./generated/HyperfeedClient";
import type { Feed } from "./useFeed";
import { appLook } from "./apps";
import { resolvable, timeLabel } from "./format";
import { AskAgent, Badge, Choices, LATER_MS, Resolver, Status } from "./FeedView";
import { agentDigest, digestLine, groupSentence, headlineOf, isNoise, teamGroups, type Headline, type TeamGroup } from "./team";

const appName = (key: string) => appLook(key).name;

/**
 * The feed as a team reads it.
 *
 * On top, what needs you, each with its buttons right on the card. Below,
 * what your team did around you, one card per subject however many updates
 * it had. Your agent's work is one digest card, not a row per step: you open
 * it when you want the detail. Reads your agent made never show.
 */
export function TeamView({ feed, query, onChat }: { feed: Feed; query: string; onChat?: (chain: string) => void }) {
  const { page } = feed;
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
      <AskAgent feed={feed} chain="" label="Ask your agent" onPosted={(m) => onChat?.(m.chain)} />

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
                  <NeedsCard key={item.chain} item={item} feed={feed} onChat={onChat} />
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
                <p className="lane-empty">Nothing from your team yet. Approve a lens in Controls and their mentions, assignments and polls show here.</p>
              ) : (
                <ul className="team-posts">
                  {groups.map((g) => (
                    <GroupPost key={g.key} group={g} />
                  ))}
                </ul>
              )}
            </section>

            <AgentCard items={digest.items} line={digestLine(digest)} onChat={onChat} />
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
function NeedsCard({ item, feed, onChat }: { item: FeedItem; feed: Feed; onChat?: (chain: string) => void }) {
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
function AgentCard({ items, line, onChat }: { items: FeedItem[]; line: string; onChat?: (chain: string) => void }) {
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
                {i.kind === "message" && onChat ? (
                  <button type="button" className="link" onClick={() => onChat(i.chain)}>
                    {h.object || i.title}
                  </button>
                ) : (
                  <span>{h.object || i.title}</span>
                )}
                <Status item={i} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
