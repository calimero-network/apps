import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAudience } from "../components/AudienceShell";
import { Avatar, Empty } from "../components/bits";
import { ChevronRightIcon, HelpCircleIcon, MessageIcon } from "../components/icons";
import { personLabel, timeAgo, useLive, useRevision, useUpdatesClient } from "../lib/updates";

/**
 * Q&A: the investor-initiated half of the conversation.
 *
 * An update tool that only broadcasts leaves investors one channel back — a
 * reply to the latest email. Here anyone in the audience can open a question
 * any time; the team answers in the thread and marks it answered, and every
 * other investor sees the answer too, which is the point: the same question
 * does not get asked eight times.
 */
export default function QuestionsPage() {
  const client = useUpdatesClient();
  const navigate = useNavigate();
  const { me, reload: reloadShell } = useAudience();
  const { bump } = useRevision();
  const [filter, setFilter] = useState<"open" | "all">("all");
  const questions = useLive(
    (c) => c.listPosts({ kind: "question", category_id: null, cursor: null, limit: 100 }),
    [],
  );
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    if (!client || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const id = await client.askQuestion({ title: title.trim(), body: body.trim(), category_id: null });
      setTitle("");
      setBody("");
      bump();
      reloadShell();
      navigate(`/a/p/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const items = (questions.data?.items ?? []).filter((q) => filter === "all" || q.status === "open");

  return (
    <>
      <div className="pageHead">
        <div>
          <h1 className="pageTitle">Q&amp;A</h1>
          <p className="pageSub">Questions and answers everyone in this audience can read.</p>
        </div>
      </div>
      <section className="askBox" data-testid="question-box">
        <h2 className="cardTitle">{me?.is_team ? "Start a thread" : "Ask the team"}</h2>
        <input
          aria-label="Question"
          placeholder={me?.is_team ? "e.g. “Office hours this Friday — bring questions”" : "e.g. “What's the runway after the new hires?”"}
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
        />
        {title.trim() && (
          <textarea
            rows={3}
            aria-label="Details"
            placeholder="Details (optional)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        )}
        <div className="row end">
          {error && <span className="errorText">{error}</span>}
          <span className="muted small grow">Everyone in this audience can read the thread.</span>
          <button className="primary small" disabled={busy || !title.trim()} onClick={() => void ask()}>
            {busy ? "Posting…" : "Post"}
          </button>
        </div>
      </section>

      <div className="tabs" role="tablist" aria-label="Filter">
        {(["all", "open"] as const).map((f) => (
          <button key={f} role="tab" className="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : "Unanswered"}
          </button>
        ))}
      </div>

      {questions.error && <div className="error">{questions.error}</div>}
      {items.length > 0 && (
        <div className="listCard">
          {items.map((q) => (
            <Link key={q.id} to={`/a/p/${q.id}`} className="questionRow" data-testid="question-row">
              <Avatar name={q.author_name} account={q.author} team={q.author_is_team} />
              <div className="questionMain">
                <h2 className="questionTitle">{q.title}</h2>
                <div className="meta">
                  <span>{personLabel(q.author_name, q.author)}</span>
                  <span>· {timeAgo(q.created_at)}</span>
                </div>
              </div>
              <span className={`pill ${q.status === "answered" ? "ok" : "warn"}`}>
                {q.status === "answered" ? "Answered" : "Open"}
              </span>
              <span className="replyCount" title="Replies">
                <MessageIcon size={14} /> {q.comment_count}
              </span>
              <ChevronRightIcon size={16} className="rowChevron" />
            </Link>
          ))}
        </div>
      )}
      {!questions.loading && items.length === 0 && (
        <Empty icon={<HelpCircleIcon size={20} />} title={filter === "open" ? "Nothing waiting on an answer." : "No questions yet."}>
          Questions and answers are visible to everyone in this audience.
        </Empty>
      )}
    </>
  );
}
