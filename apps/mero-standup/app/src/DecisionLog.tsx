import { useEffect, useState } from "react";
import type { DecisionView, MemberView } from "./generated/StandupClient";
import { describeDay, relativeTime } from "./lib/days";
import { displayName } from "./lib/people";
import { parseTags } from "./lib/tags";
import { Avatar, isSubmitShortcut, RichText, SUBMIT_HINT } from "./ui";
import { useRead, type Team } from "./useTeam";

const PAGE = 25;

/** What the standup board hands over when you log a decision from an update. */
export interface DecisionDraft {
  fromDay: string;
}

/**
 * The team's decision log: what was decided, why, with whom, and what
 * replaced it.
 *
 * A logged decision is never edited — the contract stores it write-once. To
 * change course you log a NEW decision that supersedes the old one, and both
 * stay in the log, linked, so "why did we do it that way?" always has an
 * answer.
 */
export function DecisionLog({
  team,
  draft,
  onDraftUsed,
}: {
  team: Team;
  draft: DecisionDraft | null;
  onDraftUsed: () => void;
}) {
  const { client, version, act } = team;
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [standingOnly, setStandingOnly] = useState(false);
  const [view, setView] = useState<"list" | "timeline">("list");
  const [pages, setPages] = useState(1);
  const [superseding, setSuperseding] = useState<DecisionView | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const log = useRead(
    client,
    version,
    (c) =>
      c.listDecisions({
        search: search.trim() || null,
        tag,
        from_day: null,
        standing_only: standingOnly,
        cursor: null,
        limit: PAGE * pages,
      }),
    [search, tag, standingOnly, pages],
  );
  const tags = useRead(client, version, (c) => c.tags(), []);
  const members = useRead(client, version, (c) => c.members(), []);
  const items = log.data?.items ?? [];
  const filtered = Boolean(search.trim() || tag || standingOnly);

  return (
    <div className="decisions-page">
      <DecisionForm
        key={`${superseding?.id ?? "new"}:${draft?.fromDay ?? ""}`}
        superseding={superseding}
        fromDay={draft?.fromDay ?? null}
        members={members.data ?? []}
        knownTags={tags.data?.map((t) => t.tag) ?? []}
        onCancel={() => {
          setSuperseding(null);
          onDraftUsed();
        }}
        onLogged={(id) => {
          setSuperseding(null);
          onDraftUsed();
          setFocus(id);
        }}
        act={act}
      />

      <section className="card">
        <div className="card-head">
          <h2>Decision log</h2>
          <div className="segmented" role="radiogroup" aria-label="view">
            {(["list", "timeline"] as const).map((v) => (
              <button
                key={v}
                role="radio"
                aria-checked={view === v}
                className={view === v ? "active" : ""}
                onClick={() => setView(v)}
              >
                {v === "list" ? "List" : "Timeline"}
              </button>
            ))}
          </div>
        </div>
        <div className="row filters">
          <input
            aria-label="search decisions"
            placeholder="Search titles, decisions, reasons and tags"
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
        {tags.data && tags.data.length > 0 && (
          <div className="row tag-filter" aria-label="filter by tag">
            {tags.data.map((t) => (
              <button
                key={t.tag}
                className={tag === t.tag ? "tag active" : "tag"}
                aria-pressed={tag === t.tag}
                onClick={() => setTag(tag === t.tag ? null : t.tag)}
              >
                #{t.tag} <span className="dim">{t.count}</span>
              </button>
            ))}
          </div>
        )}

        {log.error && <pre className="err">{log.error}</pre>}
        {log.data && items.length === 0 && (
          <div className="empty-state">
            {filtered ? (
              <p>No decision matches that.</p>
            ) : (
              <>
                <p>
                  <strong>No decisions yet.</strong>
                </p>
                <p className="empty">
                  Log the first one above. Six months from now, &ldquo;why did we do it this
                  way?&rdquo; will have an answer.
                </p>
              </>
            )}
          </div>
        )}

        {view === "list" ? (
          <ul className="decisions" data-testid="decisions">
            {items.map((d) => (
              <DecisionItem
                key={d.id}
                decision={d}
                highlighted={focus === d.id}
                titleOf={(id) => items.find((x) => x.id === id)?.title}
                onTag={(t) => setTag(t)}
                onJump={(id) => {
                  setSearch("");
                  setTag(null);
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
        ) : (
          <Timeline items={items} />
        )}

        {log.data?.next_cursor && (
          <button className="ghost" onClick={() => setPages((p) => p + 1)}>
            Show older
          </button>
        )}
      </section>
    </div>
  );
}

/** The log as a vertical timeline, grouped by month, newest first. */
function Timeline({ items }: { items: DecisionView[] }) {
  const months = new Map<string, DecisionView[]>();
  for (const d of items) {
    const label = new Date(d.created_at / 1e6).toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
    months.set(label, [...(months.get(label) ?? []), d]);
  }
  return (
    <div className="timeline" data-testid="timeline">
      {[...months.entries()].map(([month, ds]) => (
        <div key={month} className="timeline-month">
          <h3>{month}</h3>
          <ol>
            {ds.map((d) => (
              <li key={d.id} className={d.superseded_by ? "replaced" : ""}>
                <span className="timeline-dot" />
                <div>
                  <strong>{d.title}</strong>{" "}
                  <span className="dim">
                    {new Date(d.created_at / 1e6).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    · {displayName(d.author, d.author_name)}
                  </span>
                  {d.superseded_by && <span className="badge muted">Superseded</span>}
                  <p className="dim small">{d.decision}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function DecisionItem({
  decision: d,
  highlighted,
  titleOf,
  onTag,
  onJump,
  onSupersede,
}: {
  decision: DecisionView;
  highlighted: boolean;
  titleOf: (id: string) => string | undefined;
  onTag: (tag: string) => void;
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
      <RichText text={d.decision} />
      {d.rationale && (
        <div className="field">
          <span className="label">Why</span>
          <RichText text={d.rationale} />
        </div>
      )}
      {(d.tags.length > 0 || d.with.length > 0) && (
        <div className="row decision-notes">
          {d.tags.map((t) => (
            <button key={t} className="tag" onClick={() => onTag(t)}>
              #{t}
            </button>
          ))}
          {d.with.length > 0 && (
            <span className="with" title="Named by the author as involved">
              with
              {d.with.map((p) => (
                <span key={p.account} className="with-person">
                  <Avatar account={p.account} name={p.name} size={18} />
                  {displayName(p.account, p.name)}
                </span>
              ))}
            </span>
          )}
        </div>
      )}
      <div className="meta">
        <span className="dim">
          {displayName(d.author, d.author_name)} · {relativeTime(d.created_at)}
          {d.from_day && ` · from the ${describeDay(d.from_day).toLowerCase()} standup`}
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
  fromDay,
  members,
  knownTags,
  onCancel,
  onLogged,
  act,
}: {
  superseding: DecisionView | null;
  fromDay: string | null;
  members: MemberView[];
  knownTags: string[];
  onCancel: () => void;
  onLogged: (id: string) => void;
  act: Team["act"];
}) {
  const [title, setTitle] = useState("");
  const [decision, setDecision] = useState("");
  const [rationale, setRationale] = useState("");
  const [tagInput, setTagInput] = useState(superseding ? superseding.tags.join(", ") : "");
  const [withSet, setWithSet] = useState<Set<string>>(
    () => new Set(superseding?.with.map((p) => p.account) ?? []),
  );
  const [origin, setOrigin] = useState<string | null>(fromDay);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(Boolean(superseding || fromDay));

  useEffect(() => setOrigin(fromDay), [fromDay]);

  const tags = parseTags(tagInput);
  const ready = title.trim() && decision.trim();

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = await act((c) =>
        c.logDecision({
          title,
          decision,
          rationale,
          supersedes: superseding?.id ?? null,
          tags,
          with: [...withSet],
          from_day: origin,
        }),
      );
      setTitle("");
      setDecision("");
      setRationale("");
      setTagInput("");
      setWithSet(new Set());
      setOrigin(null);
      setOpen(false);
      onLogged(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="card new-decision" onClick={() => setOpen(true)}>
        <span className="plus">+</span> Log a decision
      </button>
    );
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isSubmitShortcut(e)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <form
      className="card my-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="card-head">
        <h2>{superseding ? "Supersede a decision" : "Log a decision"}</h2>
        {origin && (
          <span className="hint">
            From the {describeDay(origin).toLowerCase()} standup{" "}
            <button type="button" className="link quiet" onClick={() => setOrigin(null)}>
              remove
            </button>
          </span>
        )}
      </div>
      {superseding && (
        <p className="empty">
          Replacing &ldquo;{superseding.title}&rdquo;. The original stays in the log, marked
          superseded.
        </p>
      )}
      <label>
        <span className="label">Title</span>
        <input
          aria-label="decision title"
          placeholder="Release every two weeks"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKeyDown}
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
          onKeyDown={onKeyDown}
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
          onKeyDown={onKeyDown}
        />
      </label>
      <label>
        <span className="label">Tags</span>
        <input
          aria-label="tags"
          placeholder="infra, release process"
          list="known-tags"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <datalist id="known-tags">
          {knownTags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        {tags.length > 0 && (
          <span className="row">
            {tags.map((t) => (
              <span key={t} className="tag static">
                #{t}
              </span>
            ))}
          </span>
        )}
      </label>
      {members.length > 0 && (
        <fieldset className="with-picker">
          <legend className="label">Decided with</legend>
          <div className="row">
            {members.map((m) => {
              const on = withSet.has(m.account);
              return (
                <button
                  type="button"
                  key={m.account}
                  className={on ? "chip person active" : "chip person"}
                  aria-pressed={on}
                  onClick={() => {
                    const next = new Set(withSet);
                    if (on) next.delete(m.account);
                    else next.add(m.account);
                    setWithSet(next);
                  }}
                >
                  <Avatar account={m.account} name={m.name} size={18} />
                  {displayName(m.account, m.name)}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      <p className="empty">Decisions can&apos;t be edited once logged — supersede one to change course.</p>
      <div className="row">
        <button type="submit" disabled={busy || !ready}>
          {busy ? "Logging…" : superseding ? "Log replacement" : "Log decision"}
        </button>
        <button type="button" className="ghost" onClick={() => {
          setOpen(false);
          onCancel();
        }}>
          Cancel
        </button>
        <span className="dim kbd-hint">{SUBMIT_HINT}</span>
      </div>
      {error && <pre className="err">{error}</pre>}
    </form>
  );
}
