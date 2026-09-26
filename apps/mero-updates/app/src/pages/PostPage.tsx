import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import AskCard from "../components/AskCard";
import { useAudience } from "../components/AudienceShell";
import { CategoryChip, Reactions } from "../components/bits";
import Comments from "../components/Comments";
import type { MetricSeries, PostView } from "../generated/UpdatesClient";
import {
  deltaLabel,
  formatDate,
  personLabel,
  useLive,
  useRevision,
  useUpdatesClient,
} from "../lib/updates";

export default function PostPage() {
  const { postId = "" } = useParams();
  const navigate = useNavigate();
  const client = useUpdatesClient();
  const { me, categories, reload: reloadShell } = useAudience();
  const { bump } = useRevision();
  const post = useLive((c) => c.getPost({ post_id: postId }), [postId]);
  const metrics = useLive((c) => c.listMetrics(), []);
  const isTeam = !!me?.is_team;
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The read receipt: once per open, and only after the post actually loaded.
  // It is what fills the team's "who read it" list, so it must not fire for a
  // post that failed to render.
  const marked = useRef<string | null>(null);
  useEffect(() => {
    if (!client || !post.data || marked.current === postId) return;
    marked.current = postId;
    if (post.data.card.read_by_me) return;
    void client
      .markRead({ post_id: postId })
      .then(() => reloadShell())
      .catch(() => undefined);
  }, [client, post.data, postId, reloadShell]);

  if (post.error)
    return (
      <div className="error">
        {post.error} <Link to="/a">Back to updates</Link>
      </div>
    );
  if (!post.data) return <div className="skeleton tall" />;

  const p = post.data;
  const card = p.card;
  const isQuestion = card.kind === "question";
  const cat = categories.find((c) => c.id === card.category_id);

  const toggleReaction = async (emoji: string, on: boolean) => {
    if (!client) return;
    post.setData({
      ...p,
      card: {
        ...card,
        reactions: card.reactions.map((r) =>
          r.emoji === emoji ? { ...r, mine: on, count: r.count + (on ? 1 : -1) } : r,
        ),
      },
    });
    await client.react({ post_id: postId, emoji, on }).catch(() => post.reload());
  };

  const remove = async () => {
    if (!client) return;
    await client.deletePost({ post_id: postId });
    bump();
    navigate(isQuestion ? "/a/questions" : "/a");
  };

  const setStatus = async (status: string) => {
    await client?.setQuestionStatus({ post_id: postId, status });
    post.reload();
    reloadShell();
  };

  return (
    <article className="post" data-testid="post">
      <Link className="back" to={isQuestion ? "/a/questions" : "/a"}>
        {isQuestion ? "Q&A" : "Updates"}
      </Link>

      <div className="meta">
        {isQuestion && (
          <span className={`pill ${card.status === "answered" ? "ok" : "warn"}`}>
            {card.status === "answered" ? "Answered" : "Open question"}
          </span>
        )}
        {cat && <CategoryChip category={cat} />}
        <span>{formatDate(card.created_at)}</span>
        <span>· {personLabel(card.author_name, card.author)}</span>
        {card.edited_at > card.created_at + 1000 && <span>· edited</span>}
        {isTeam && !isQuestion && (
          <span title="Members who opened it, including the team">· 👁 {card.read_count} read</span>
        )}
      </div>
      <h1 className="postTitle">{card.title}</h1>
      {card.summary && <p className="tldr">{card.summary}</p>}

      {p.metrics.length > 0 && <KpiTiles post={p} series={metrics.data ?? []} />}

      {p.sections.map((s, i) => (
        <section key={i} className="postSection" data-kind={s.kind}>
          {s.title && <h2>{s.title}</h2>}
          <p>{s.body}</p>
        </section>
      ))}

      {p.asks.length > 0 && (
        <section className="postAsks">
          <h2 className="sectionLabel">How you can help</h2>
          {p.asks.map((a) => (
            <AskCard key={a.id} ask={a} isTeam={isTeam} onChanged={post.reload} />
          ))}
        </section>
      )}

      <Reactions reactions={card.reactions} onToggle={(e, on) => void toggleReaction(e, on)} />

      {(isTeam || (isQuestion && card.author === me?.account)) && (
        <div className="row wrap postTools">
          {isTeam && !isQuestion && (
            <Link className="ghost small" to={`/a/compose?edit=${postId}`}>
              Edit
            </Link>
          )}
          {isTeam && isQuestion && (
            <button
              className="ghost small"
              onClick={() => void setStatus(card.status === "answered" ? "open" : "answered")}
            >
              {card.status === "answered" ? "Re-open" : "Mark answered"}
            </button>
          )}
          {confirmDelete ? (
            <>
              <span className="muted small">Delete for everyone?</span>
              <button className="danger small" onClick={() => void remove()}>
                Delete
              </button>
              <button className="ghost small" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="ghost small" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
        </div>
      )}

      <Comments
        postId={postId}
        isTeam={isTeam}
        placeholder={
          isTeam
            ? isQuestion
              ? "Answer the question…"
              : "Add a note for your investors…"
            : isQuestion
              ? "Add to the question…"
              : "Reply to the team — questions, congratulations, pushback…"
        }
      />
    </article>
  );
}

/**
 * KPIs as tiles, each with the change since the previous update that
 * reported the same metric. The comparison is computed, not typed — which is
 * the whole reason KPIs are structured rather than a line in the body.
 */
function KpiTiles({ post, series }: { post: PostView; series: MetricSeries[] }) {
  return (
    <div className="kpis" aria-label="KPIs">
      {post.metrics.map((m) => {
        const s = series.find((x) => x.name.toLowerCase() === m.name.toLowerCase());
        const idx = s?.points.findIndex((pt) => pt.post_id === post.card.id) ?? -1;
        const prev = s && idx > 0 ? s.points[idx - 1] : null;
        const delta = prev ? deltaLabel(prev.value, m.value) : null;
        return (
          <div key={m.name} className="kpi">
            <span className="kpiName">{m.name}</span>
            <span className="kpiValue">
              {m.value}
              {m.unit && <small> {m.unit}</small>}
            </span>
            {delta && (
              <span className="kpiDelta" data-dir={delta.startsWith("+") ? "up" : delta.startsWith("−") ? "down" : "flat"}>
                {delta} <span className="muted">vs {prev!.value}</span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
