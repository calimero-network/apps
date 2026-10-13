import { useState } from "react";
import type { DecisionView } from "./generated/StandupClient";
import { describeTime } from "./lib/days";
import { displayName } from "./lib/people";
import { useRead, type useTeam } from "./useTeam";

type Team = ReturnType<typeof useTeam>;

const PAGE = 25;

/**
 * The team's decision log: what was decided, why, and what replaced it.
 *
 * A logged decision is never edited — the contract stores it write-once. To
 * change course you log a NEW decision that supersedes the old one, and both
 * stay in the log, linked, so "why did we do it that way?" always has an
 * answer.
 */
export function DecisionLog({ team }: { team: Team }) {
  const { client, version, act } = team;
  const [search, setSearch] = useState("");
  const [standingOnly, setStandingOnly] = useState(false);
  const [pages, setPages] = useState(1);
  const [superseding, setSuperseding] = useState<DecisionView | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const log = useRead(
    client,
    version,
    (c) =>
      c.listDecisions({
        search: search.trim() || null,
        standing_only: standingOnly,
        cursor: null,
        limit: PAGE * pages,
      }),
    [search, standingOnly, pages],
  );
  const items = log.data?.items ?? [];

  return (
    <>
      <DecisionForm
        key={superseding?.id ?? "new"}
        superseding={superseding}
        onCancel={() => setSuperseding(null)}
        onLogged={(id) => {
          setSuperseding(null);
          setFocus(id);
        }}
        act={act}
      />

      <div className="card">
        <h2>Decision log</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          <input
            aria-label="search decisions"
            placeholder="Search titles, decisions and reasons"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPages(1);
            }}
          />
          <label className="toggle">
            <input
              type="checkbox"
              checked={standingOnly}
              onChange={(e) => setStandingOnly(e.target.checked)}
            />
            Standing only
          </label>
        </div>

        {log.error && <pre className="err">{log.error}</pre>}
        {log.data && items.length === 0 && (
          <p className="empty">
            {search.trim()
              ? "No decision matches that."
              : "No decisions yet. Log the first one above — future you will thank you."}
          </p>
        )}

        <ul className="decisions" data-testid="decisions">
          {items.map((d) => (
            <DecisionItem
              key={d.id}
              decision={d}
              highlighted={focus === d.id}
              titleOf={(id) => items.find((x) => x.id === id)?.title}
              onJump={(id) => {
                setSearch("");
                setStandingOnly(false);
                setFocus(id);
                document.getElementById(`decision-${id}`)?.scrollIntoView({ block: "center" });
              }}
              onSupersede={() => {
                setSuperseding(d);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          ))}
        </ul>

        {log.data?.next_cursor && (
          <button className="ghost" onClick={() => setPages((p) => p + 1)}>
            Show older
          </button>
        )}
      </div>
    </>
  );
}

function DecisionItem({
  decision: d,
  highlighted,
  titleOf,
  onJump,
  onSupersede,
}: {
  decision: DecisionView;
  highlighted: boolean;
  titleOf: (id: string) => string | undefined;
  onJump: (id: string) => void;
  onSupersede: () => void;
}) {
  const replaced = d.superseded_by !== "";
  return (
    <li
      id={`decision-${d.id}`}
      className={["decision", replaced ? "replaced" : "", highlighted ? "highlight" : ""].join(" ")}
    >
      <div className="byline">
        <strong className="decision-title">{d.title}</strong>
        <span className={replaced ? "badge muted" : "badge"}>{replaced ? "Superseded" : "Standing"}</span>
      </div>
      <p className="pre">{d.decision}</p>
      {d.rationale && (
        <div className="field">
          <span className="label">Why</span>
          <p className="pre">{d.rationale}</p>
        </div>
      )}
      <div className="meta">
        <span className="dim">
          {displayName(d.author, d.author_name)} · {describeTime(d.created_at)}
        </span>
        {d.supersedes && (
          <button className="link" onClick={() => onJump(d.supersedes)}>
            Replaces “{titleOf(d.supersedes) ?? "an earlier decision"}”
          </button>
        )}
        {replaced && (
          <button className="link" onClick={() => onJump(d.superseded_by)}>
            Replaced by “{titleOf(d.superseded_by) ?? "a later decision"}”
          </button>
        )}
        {!replaced && (
          <button className="link" onClick={onSupersede}>
            Supersede…
          </button>
        )}
      </div>
    </li>
  );
}

function DecisionForm({
  superseding,
  onCancel,
  onLogged,
  act,
}: {
  superseding: DecisionView | null;
  onCancel: () => void;
  onLogged: (id: string) => void;
  act: Team["act"];
}) {
  const [title, setTitle] = useState("");
  const [decision, setDecision] = useState("");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const id = await act((c) =>
        c.logDecision({
          title,
          decision,
          rationale,
          supersedes: superseding?.id ?? null,
        }),
      );
      setTitle("");
      setDecision("");
      setRationale("");
      onLogged(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="card my-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2>{superseding ? "Supersede a decision" : "Log a decision"}</h2>
      {superseding && (
        <p className="empty" style={{ marginTop: -6 }}>
          Replacing “{superseding.title}”. The original stays in the log, marked superseded.
        </p>
      )}
      <label>
        <span className="label">Title</span>
        <input
          aria-label="decision title"
          placeholder="Release every two weeks"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        <span className="label">Decision</span>
        <textarea
          aria-label="decision"
          rows={2}
          placeholder="What exactly was decided"
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
        />
      </label>
      <label>
        <span className="label">Why</span>
        <textarea
          aria-label="rationale"
          rows={2}
          placeholder="Context, options considered, why this one"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
        />
      </label>
      <p className="empty">Decisions can&apos;t be edited once logged — supersede one to change course.</p>
      <div className="row">
        <button type="submit" disabled={busy || !title.trim() || !decision.trim()}>
          {busy ? "Logging…" : superseding ? "Log replacement" : "Log decision"}
        </button>
        {superseding && (
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {error && <pre className="err">{error}</pre>}
    </form>
  );
}
