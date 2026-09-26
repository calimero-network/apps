import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { useAudience } from "../components/AudienceShell";
import { CategoryChip } from "../components/bits";
import type { MetricSeries } from "../generated/UpdatesClient";
import {
  TEMPLATES,
  fromPost,
  fromPrevious,
  fromTemplate,
  parseDraft,
  publishBlocker,
  thanksSection,
  toInput,
  type ComposerState,
} from "../lib/templates";
import {
  ASK_KINDS,
  askKind,
  deltaLabel,
  timeAgo,
  useLive,
  useRevision,
  useUpdatesClient,
} from "../lib/updates";

/** Idle time before an edit is saved as a draft. */
const AUTOSAVE_MS = 1500;

const SECTION_SUGGESTIONS = [
  { kind: "highlights", title: "Highlights" },
  { kind: "lowlights", title: "Lowlights" },
  { kind: "product", title: "Product" },
  { kind: "team", title: "Team" },
  { kind: "financial", title: "Financials" },
  { kind: "text", title: "" },
];

/**
 * Write an update.
 *
 * Opened four ways — `?template=`, `?from=latest` (reuse the previous one's
 * shape), `?draft=` (resume) and `?edit=` (change a published update) — and
 * all four land in the same `ComposerState`, so there is one editor.
 *
 * Drafts autosave into the contract's PRIVATE storage: node-local, never
 * replicated. An investor cannot see an unfinished update because it does not
 * exist anywhere but this node until Publish.
 */
export default function ComposePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const client = useUpdatesClient();
  const { me, categories, reload: reloadShell } = useAudience();
  const { bump } = useRevision();
  const metrics = useLive((c) => c.listMetrics(), []);
  const lastUpdateAt = useAudience().overview?.last_update_at ?? 0;
  const contributions = useLive((c) => c.listContributions({ since: lastUpdateAt }), [lastUpdateAt]);

  const editId = params.get("edit");
  const [state, setState] = useState<ComposerState | null>(null);
  const [draftId, setDraftId] = useState<string | null>(params.get("draft"));
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);

  // ── load the starting point, once ─────────────────────────────────────────
  const started = useRef(false);
  useEffect(() => {
    if (!client || started.current || metrics.loading) return;
    started.current = true;
    const series = metrics.data ?? [];
    (async () => {
      try {
        if (editId) {
          setState(fromPost(await client.getPost({ post_id: editId })));
        } else if (params.get("draft")) {
          const d = (await client.listDrafts()).find((x) => x.id === params.get("draft"));
          const parsed = d && parseDraft(d.payload);
          setState(parsed ?? fromTemplate(TEMPLATES[0], series));
          if (d) setSavedAt(d.updated_at);
        } else if (params.get("from") === "latest") {
          const page = await client.listPosts({ kind: "update", category_id: null, cursor: null, limit: 1 });
          const latest = page.items[0];
          setState(
            latest
              ? fromPrevious(await client.getPost({ post_id: latest.id }))
              : fromTemplate(TEMPLATES[0], series),
          );
        } else {
          const t = TEMPLATES.find((x) => x.id === params.get("template")) ?? TEMPLATES[0];
          setState(fromTemplate(t, series));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [client, metrics.loading, metrics.data, editId, params]);

  // ── autosave (new updates only — an edit of a published one is not a draft)
  useEffect(() => {
    if (!client || !state || editId || !dirty.current) return;
    const t = setTimeout(async () => {
      try {
        const id = await client.saveDraft({
          draft_id: draftId,
          title: state.title,
          payload: JSON.stringify(state),
        });
        if (!draftId) {
          setDraftId(id);
          // Keep the URL resumable without adding a history entry.
          window.history.replaceState(null, "", `/a/compose?draft=${id}`);
        }
        setSavedAt(Date.now());
      } catch {
        /* the next keystroke retries; publishing never depends on a draft */
      }
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [client, state, draftId, editId]);

  const update = (fn: (s: ComposerState) => ComposerState) => {
    dirty.current = true;
    setState((s) => (s ? fn(s) : s));
  };

  const blocker = state ? publishBlocker(state) : "Loading…";

  const publish = async () => {
    if (!client || !state || blocker) return;
    setBusy(true);
    setError(null);
    try {
      let id: string;
      if (editId) {
        await client.editUpdate({ post_id: editId, input: toInput(state) });
        id = editId;
      } else {
        id = await client.publishUpdate({ input: toInput(state) });
        if (draftId) await client.deleteDraft({ draft_id: draftId }).catch(() => undefined);
      }
      dirty.current = false;
      bump();
      reloadShell();
      navigate(`/a/p/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (me && !me.is_team)
    return (
      <div className="notice">
        Only the company team can publish updates. You can <Link to="/a/questions">ask a question</Link> instead.
      </div>
    );
  if (error && !state) return <div className="error">{error}</div>;
  if (!state) return <div className="skeleton tall" />;

  const thanks = thanksSection(contributions.data ?? []);
  const hasThanks = state.sections.some((s) => s.kind === "thanks");

  return (
    <div className="compose" data-testid="composer">
      <div className="composeTop">
        <Link className="back" to="/a">
          Updates
        </Link>
        <div className="tabs" role="tablist">
          {(["write", "preview"] as const).map((t) => (
            <button key={t} role="tab" className="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t === "write" ? "Write" : "Preview"}
            </button>
          ))}
        </div>
        <div className="grow" />
        {!editId && (
          <span className="muted small" data-testid="draft-status">
            {savedAt ? `Draft saved on this node · ${timeAgo(savedAt)}` : "Drafts stay on this node until you publish"}
          </span>
        )}
      </div>

      {tab === "preview" ? (
        <Preview state={state} series={metrics.data ?? []} />
      ) : (
        <>
          <input
            className="titleInput"
            aria-label="Title"
            placeholder="Title — e.g. “June 2026 update”"
            value={state.title}
            maxLength={200}
            onChange={(e) => update((s) => ({ ...s, title: e.target.value }))}
          />
          <div className="row wrap">
            <label className="fieldLabel" htmlFor="cat">
              Category
            </label>
            <select
              id="cat"
              value={state.categoryId}
              onChange={(e) => update((s) => ({ ...s, categoryId: e.target.value }))}
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji ? `${c.emoji} ` : ""}
                  {c.name}
                </option>
              ))}
            </select>
            {categories.length === 0 && (
              <Link className="small" to="/a/settings">
                Create categories
              </Link>
            )}
          </div>
          <textarea
            aria-label="Summary"
            rows={2}
            placeholder="TL;DR — the one paragraph a busy investor will read."
            value={state.summary}
            maxLength={1000}
            onChange={(e) => update((s) => ({ ...s, summary: e.target.value }))}
          />

          <MetricsEditor state={state} update={update} series={metrics.data ?? []} />

          <h2 className="sectionLabel">Sections</h2>
          {state.sections.map((sec, i) => (
            <div key={i} className="sectionEditor">
              <div className="row">
                <input
                  aria-label="Section heading"
                  placeholder="Heading (optional)"
                  value={sec.title}
                  onChange={(e) =>
                    update((s) => ({
                      ...s,
                      sections: s.sections.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                    }))
                  }
                />
                <button
                  className="iconBtn"
                  title="Move up"
                  disabled={i === 0}
                  onClick={() =>
                    update((s) => {
                      const next = [...s.sections];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      return { ...s, sections: next };
                    })
                  }
                >
                  ↑
                </button>
                <button
                  className="iconBtn"
                  title="Remove section"
                  onClick={() => update((s) => ({ ...s, sections: s.sections.filter((_, j) => j !== i) }))}
                >
                  ✕
                </button>
              </div>
              <textarea
                rows={4}
                aria-label={sec.title || "Section body"}
                placeholder={
                  TEMPLATES.flatMap((t) => t.sections).find((t) => t.kind === sec.kind)?.placeholder ??
                  "Write…"
                }
                value={sec.body}
                onChange={(e) =>
                  update((s) => ({
                    ...s,
                    sections: s.sections.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)),
                  }))
                }
              />
            </div>
          ))}
          <div className="row wrap">
            <span className="muted small">Add:</span>
            {SECTION_SUGGESTIONS.filter((x) => !x.title || !state.sections.some((s) => s.kind === x.kind)).map(
              (x) => (
                <button
                  key={x.kind}
                  className="ghost small"
                  onClick={() => update((s) => ({ ...s, sections: [...s.sections, { ...x, body: "" }] }))}
                >
                  + {x.title || "Text"}
                </button>
              ),
            )}
            {thanks && !hasThanks && (
              <button
                className="ghost small accent"
                data-testid="insert-thanks"
                onClick={() => update((s) => ({ ...s, sections: [...s.sections, thanks] }))}
              >
                + Thank {contributions.data!.length} contributor{contributions.data!.length === 1 ? "" : "s"}
              </button>
            )}
          </div>

          <AsksEditor state={state} update={update} />
        </>
      )}

      <div className="publishBar">
        {error && <span className="errorText">{error}</span>}
        {blocker && <span className="muted small">{blocker}</span>}
        <div className="grow" />
        <button
          className="primary"
          disabled={busy || !!blocker}
          onClick={() => void publish()}
          data-testid="publish"
        >
          {busy ? "Publishing…" : editId ? "Save changes" : "Publish to this audience"}
        </button>
      </div>
    </div>
  );
}

function MetricsEditor({
  state,
  update,
  series,
}: {
  state: ComposerState;
  update: (fn: (s: ComposerState) => ComposerState) => void;
  series: MetricSeries[];
}) {
  const last = (name: string) => {
    const s = series.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    return s?.points[s.points.length - 1]?.value ?? null;
  };
  const known = useMemo(
    () => series.filter((s) => !state.metrics.some((m) => m.name.toLowerCase() === s.name.toLowerCase())),
    [series, state.metrics],
  );
  const set = (i: number, patch: Partial<ComposerState["metrics"][number]>) =>
    update((s) => ({ ...s, metrics: s.metrics.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));

  return (
    <>
      <h2 className="sectionLabel">KPIs</h2>
      {state.metrics.length > 0 && (
        <div className="metricTable">
          {state.metrics.map((m, i) => {
            const prev = last(m.name);
            const delta = prev && m.value ? deltaLabel(prev, m.value) : null;
            return (
              <div key={i} className="metricRow">
                <input
                  aria-label="KPI name"
                  placeholder="Name (MRR, Runway…)"
                  value={m.name}
                  onChange={(e) => set(i, { name: e.target.value })}
                />
                <input
                  aria-label={`${m.name || "KPI"} value`}
                  placeholder={prev ? `last: ${prev}` : "Value"}
                  value={m.value}
                  onChange={(e) => set(i, { value: e.target.value })}
                />
                <input
                  aria-label="Unit"
                  className="unit"
                  placeholder="unit"
                  value={m.unit}
                  onChange={(e) => set(i, { unit: e.target.value })}
                />
                <span className="metricDelta" data-dir={delta?.startsWith("+") ? "up" : delta?.startsWith("−") ? "down" : "flat"}>
                  {delta ?? (prev ? `was ${prev}` : "")}
                </span>
                <button
                  className="iconBtn"
                  title="Remove KPI"
                  onClick={() => update((s) => ({ ...s, metrics: s.metrics.filter((_, j) => j !== i) }))}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="row wrap">
        <button
          className="ghost small"
          onClick={() => update((s) => ({ ...s, metrics: [...s.metrics, { name: "", value: "", unit: "" }] }))}
        >
          + KPI
        </button>
        {known.map((k) => (
          <button
            key={k.name}
            className="ghost small"
            onClick={() => update((s) => ({ ...s, metrics: [...s.metrics, { name: k.name, value: "", unit: k.unit }] }))}
          >
            + {k.name}
          </button>
        ))}
        <span className="muted small">Leave a value blank to skip it this time.</span>
      </div>
    </>
  );
}

function AsksEditor({
  state,
  update,
}: {
  state: ComposerState;
  update: (fn: (s: ComposerState) => ComposerState) => void;
}) {
  const set = (i: number, patch: Partial<ComposerState["asks"][number]>) =>
    update((s) => ({ ...s, asks: s.asks.map((a, j) => (j === i ? { ...a, ...patch } : a)) }));
  return (
    <>
      <h2 className="sectionLabel">Asks</h2>
      <p className="muted small">
        Specific, answerable requests. Investors reply with one click on “I can help”, and you accept offers from the
        Asks tab.
      </p>
      {state.asks.map((a, i) => (
        <div key={a.id ?? `new-${i}`} className="askEditor">
          <div className="row">
            <select aria-label="Ask type" value={a.kind} onChange={(e) => set(i, { kind: e.target.value })}>
              {ASK_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.icon} {k.label}
                </option>
              ))}
            </select>
            <input
              aria-label="Ask"
              placeholder={askKind(a.kind).hint}
              value={a.title}
              onChange={(e) => set(i, { title: e.target.value })}
            />
            <button
              className="iconBtn"
              title="Remove ask"
              onClick={() => update((s) => ({ ...s, asks: s.asks.filter((_, j) => j !== i) }))}
            >
              ✕
            </button>
          </div>
          <input
            aria-label="Ask detail"
            placeholder="Detail (optional) — who exactly, and why"
            value={a.detail}
            onChange={(e) => set(i, { detail: e.target.value })}
          />
        </div>
      ))}
      <button
        className="ghost small"
        disabled={state.asks.length >= 10}
        onClick={() => update((s) => ({ ...s, asks: [...s.asks, { id: null, kind: "intro", title: "", detail: "" }] }))}
      >
        + Ask
      </button>
    </>
  );
}

/** Roughly what an investor will see — the real render is PostPage. */
function Preview({ state, series }: { state: ComposerState; series: MetricSeries[] }) {
  const { categories } = useAudience();
  const input = toInput(state);
  const cat = categories.find((c) => c.id === state.categoryId);
  return (
    <article className="post preview" data-testid="preview">
      <div className="meta">
        <span className="pill">Preview</span>
        {cat && <CategoryChip category={cat} />}
      </div>
      <h1 className="postTitle">{input.title || "Untitled"}</h1>
      {input.summary && <p className="tldr">{input.summary}</p>}
      {input.metrics.length > 0 && (
        <div className="kpis">
          {input.metrics.map((m) => {
            const s = series.find((x) => x.name.toLowerCase() === m.name.toLowerCase());
            const prev = s?.points[s.points.length - 1]?.value;
            const delta = prev ? deltaLabel(prev, m.value) : null;
            return (
              <div key={m.name} className="kpi">
                <span className="kpiName">{m.name}</span>
                <span className="kpiValue">
                  {m.value}
                  {m.unit && <small> {m.unit}</small>}
                </span>
                {delta && <span className="kpiDelta">{delta} <span className="muted">vs {prev}</span></span>}
              </div>
            );
          })}
        </div>
      )}
      {input.sections.map((s, i) => (
        <section key={i} className="postSection">
          {s.title && <h2>{s.title}</h2>}
          <p>{s.body}</p>
        </section>
      ))}
      {input.asks.length > 0 && (
        <section className="postAsks">
          <h2 className="sectionLabel">How you can help</h2>
          {input.asks.map((a, i) => (
            <div key={i} className="ask">
              <span className="askKind">
                {askKind(a.kind).icon} {askKind(a.kind).label}
              </span>
              <h3 className="askTitle">{a.title}</h3>
              {a.detail && <p className="askDetail">{a.detail}</p>}
              <button className="primary small" disabled>
                🙋 I can help
              </button>
            </div>
          ))}
        </section>
      )}
    </article>
  );
}
