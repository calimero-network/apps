import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAudience } from "../components/AudienceShell";
import { Avatar, CategoryChip, Empty } from "../components/bits";
import {
  BarChartIcon,
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  FileTextIcon,
  HandIcon,
  MessageIcon,
  PenSquareIcon,
  RepeatIcon,
} from "../components/icons";
import type { CategoryView, PostCard } from "../generated/UpdatesClient";
import { TEMPLATES } from "../lib/templates";
import { dueLabel, formatDate, personLabel, timeAgo, useLive, useUpdatesClient } from "../lib/updates";

/**
 * The home screen. Same page for both sides, weighted differently:
 *
 *   team      → "next update due" nudge, template shortcuts, drafts, setup list
 *   investor  → unread first, category filter, one click into the update
 */
export default function UpdatesPage() {
  const { me, overview, categories } = useAudience();
  const [category, setCategory] = useState<string | null>(null);
  const isTeam = !!me?.is_team;
  const feed = useLive(
    (c) => c.listPosts({ kind: "update", category_id: category, cursor: null, limit: 100 }),
    [category],
  );
  const items = feed.data?.items ?? [];
  const navigate = useNavigate();

  return (
    <>
      <div className="pageHead">
        <div>
          <h1 className="pageTitle">Updates</h1>
          <p className="pageSub">
            {isTeam
              ? "What you have sent this audience, and what is due next."
              : `Everything ${overview?.company_name || "the team"} has shared with you, newest first.`}
          </p>
        </div>
        {isTeam && (
          <button className="primary" onClick={() => navigate("/a/compose?template=monthly")}>
            <PenSquareIcon size={16} />
            New update
          </button>
        )}
      </div>

      {isTeam && <TeamPanel hasUpdates={(overview?.updates_total ?? 0) > 0} />}

      {isTeam && <h2 className="sectionTitle">Published</h2>}

      {categories.length > 0 && (
        <div className="chips" role="toolbar" aria-label="Filter by category">
          <button type="button" className="chip" data-active={category === null} onClick={() => setCategory(null)}>
            All
          </button>
          {categories.map((c) => (
            <CategoryChip
              key={c.id}
              category={c}
              active={category === c.id}
              count={c.muted ? 0 : c.unread_count}
              onClick={() => setCategory(category === c.id ? null : c.id)}
            />
          ))}
        </div>
      )}

      {feed.error && <div className="error">{feed.error}</div>}
      {feed.loading && !feed.data && (
        <>
          <div className="skeleton" />
          <div className="skeleton" />
        </>
      )}

      {items.length > 0 && (
        <div className="updateList">
          {items.map((p) => (
            <UpdateRow key={p.id} post={p} categories={categories} />
          ))}
        </div>
      )}

      {!feed.loading && items.length === 0 && (
        <Empty icon={<FileTextIcon size={20} />} title={category ? "Nothing in this category yet." : "No updates yet."}>
          {isTeam
            ? "Pick a template above — your investors see it the moment their node syncs."
            : "When the team publishes, it shows up here. You can ask them something under Q&A in the meantime."}
        </Empty>
      )}
    </>
  );
}

function UpdateRow({ post, categories }: { post: PostCard; categories: CategoryView[] }) {
  const cat = categories.find((c) => c.id === post.category_id);
  const reactions = post.reactions.filter((r) => r.count > 0);
  const hasStats =
    post.metric_count > 0 || post.open_ask_count > 0 || post.comment_count > 0 || reactions.length > 0;
  return (
    <Link to={`/a/p/${post.id}`} className="updateRow" data-unread={!post.read_by_me} data-testid="update-row">
      <div className="updateRowMain">
        <div className="meta">
          {!post.read_by_me && <span className="dot" aria-label="Unread" />}
          {cat && <CategoryChip category={cat} />}
          <span>{formatDate(post.created_at)}</span>
        </div>
        <h2 className="updateTitle">{post.title}</h2>
        {post.summary && <p className="excerpt">{post.summary}</p>}
        <div className="updateFoot">
          <span className="byline">
            <Avatar name={post.author_name} account={post.author} team={post.author_is_team} />
            {personLabel(post.author_name, post.author)}
          </span>
          {hasStats && (
            <div className="updateStats">
              {post.metric_count > 0 && (
                <span title="KPIs">
                  <BarChartIcon size={14} /> {post.metric_count}
                </span>
              )}
              {post.open_ask_count > 0 && (
                <span title="Open asks">
                  <HandIcon size={14} /> {post.open_ask_count}
                </span>
              )}
              {post.comment_count > 0 && (
                <span title="Replies">
                  <MessageIcon size={14} /> {post.comment_count}
                </span>
              )}
              {reactions.slice(0, 3).map((r) => (
                <span key={r.emoji} className="statReaction">
                  <span aria-hidden>{r.emoji}</span> {r.count}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <ChevronRightIcon size={18} className="rowChevron" />
    </Link>
  );
}

/**
 * The founder's cockpit: when the next update is due, one click into each
 * template, drafts on this node, and — until it is done — the setup checklist.
 */
function TeamPanel({ hasUpdates }: { hasUpdates: boolean }) {
  const navigate = useNavigate();
  const client = useUpdatesClient();
  const { overview, categories } = useAudience();
  const drafts = useLive((c) => c.listDrafts(), []);
  const people = useLive((c) => c.listPeople(), []);
  const investors = (people.data ?? []).filter((p) => !p.is_team).length;

  const steps = [
    { done: !!overview?.company_name, label: "Name your company and set a cadence", to: "/a/settings" },
    { done: categories.length > 0, label: "Add categories (Monthly, Fundraising, Product…)", to: "/a/settings" },
    { done: hasUpdates, label: "Publish your first update", to: "/a/compose?template=monthly" },
    { done: investors > 0, label: "Invite your investors", to: null as string | null },
  ];
  const setupDone = steps.every((s) => s.done);

  return (
    <section className="teamPanel" data-testid="team-panel">
      {overview && overview.next_due_at > 0 && (
        <div className="due" data-overdue={overview.next_due_at < Date.now()}>
          <span className="iconTile" aria-hidden>
            <CalendarIcon size={18} />
          </span>
          <div className="dueText">
            <strong>{dueLabel(overview.next_due_at)}</strong>
            <span className="muted">
              Every {overview.cadence_days} days · last sent {timeAgo(overview.last_update_at)}
            </span>
          </div>
        </div>
      )}

      <div>
        <h2 className="sectionTitle">Start from a template</h2>
        <div className="templates">
          {hasUpdates && (
            <button className="templateBtn" onClick={() => navigate("/a/compose?from=latest")}>
              <span className="iconTile accent" aria-hidden>
                <RepeatIcon size={16} />
              </span>
              <strong>Reuse the last one</strong>
              <span>Same sections and KPIs, fresh numbers.</span>
            </button>
          )}
          {TEMPLATES.slice(0, 4).map((t) => (
            <button key={t.id} className="templateBtn" onClick={() => navigate(`/a/compose?template=${t.id}`)}>
              <span className="iconTile" aria-hidden>
                <FileTextIcon size={16} />
              </span>
              <strong>{t.name}</strong>
              <span>{t.description}</span>
            </button>
          ))}
        </div>
      </div>

      {(drafts.data?.length ?? 0) > 0 && (
        <div className="drafts">
          <h2 className="sectionTitle">
            Drafts <span className="muted small">· only on this node until you publish</span>
          </h2>
          {drafts.data!.map((d) => (
            <div key={d.id} className="draftRow">
              <span className="pill">Draft</span>
              <Link to={`/a/compose?draft=${d.id}`}>{d.title || "Untitled draft"}</Link>
              <span className="muted small">Edited {timeAgo(d.updated_at)}</span>
              <span className="grow" />
              <button
                className="linkBtn danger"
                onClick={async () => {
                  await client?.deleteDraft({ draft_id: d.id });
                  drafts.reload();
                }}
              >
                Discard
              </button>
            </div>
          ))}
        </div>
      )}

      {!setupDone && (
        <ol className="checklist" aria-label="Getting started">
          <li className="checklistHead">
            <strong>Getting started</strong>
            <span className="muted small">
              {steps.filter((s) => s.done).length} of {steps.length} done
            </span>
          </li>
          {steps.map((s) => (
            <li key={s.label} data-done={s.done}>
              <span className="checkMark" aria-hidden>
                {s.done && <CheckIcon size={12} />}
              </span>
              {s.to && !s.done ? <Link to={s.to}>{s.label}</Link> : <span>{s.label}</span>}
              {!s.to && !s.done && (
                <span className="muted small"> — use Invite on the audiences page</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
