import { useEffect, useMemo, useState } from "react";
import type { FormView, ResponseView } from "./generated/FormsClient";
import { isLinked } from "./lib/crm";
import { ago, answerText, fromNanos, headline, isNew, toCsv, valueOf } from "./lib/fields";
import { shortAccount } from "./lib/people";
import { PersonName } from "./names";
import { Icon } from "./ui";
import { useSendToCrm } from "./useCrm";
import { useRead, type Workspace } from "./useWorkspace";

type Filter = "new" | "all" | "sent" | "archived";

const FILTERS: [Filter, string][] = [
  ["new", "New"],
  ["all", "All"],
  ["sent", "In CRM"],
  ["archived", "Archived"],
];

/** A form's responses: what the choice questions add up to, every response in a table, one in full. */
export function Responses({
  form,
  workspace,
  onConnect,
}: {
  form: FormView;
  workspace: Workspace;
  /** Opens the tab where the form is linked to a CRM pipeline. */
  onConnect: () => void;
}) {
  const responses = useRead(workspace.client, workspace.version, (c) => c.listResponses({ form_id: form.id }), [form.id]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; of: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = useSendToCrm(workspace);
  const linked = isLinked(form.crm);

  const all = useMemo(() => responses.data ?? [], [responses.data]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((r) => {
      if (filter === "new" && !isNew(r)) return false;
      if (filter === "sent" && !r.crm_deal) return false;
      if (filter === "archived" && !r.archived) return false;
      if (filter === "all" && r.archived) return false;
      return !q || r.answers.some((a) => answerText(a).toLowerCase().includes(q));
    });
  }, [all, filter, query]);
  const fresh = all.filter(isNew);
  const open = all.find((r) => r.id === openId) ?? null;
  // Columns: the first three questions, as the form is now.
  const columns = form.fields.slice(0, 3);

  function exportCsv() {
    const blob = new Blob([toCsv(form, all)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${form.title.replace(/[^\w-]+/g, "-").toLowerCase() || "responses"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function sendAllNew() {
    if (!window.confirm(`Send ${fresh.length} new ${fresh.length === 1 ? "response" : "responses"} to the CRM?`)) return;
    setError(null);
    setBulk({ done: 0, of: fresh.length });
    try {
      for (const [i, r] of fresh.entries()) {
        await send(form, r);
        setBulk({ done: i + 1, of: fresh.length });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulk(null);
    }
  }

  return (
    <>
      <Summary form={form} responses={all.filter((r) => !r.archived)} />

      <section className="card">
        <div className="toolbar">
          <input
            className="search"
            aria-label="search responses"
            placeholder="Search answers…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="segmented" role="radiogroup" aria-label="filter">
            {FILTERS.map(([f, label]) => (
              <button key={f} role="radio" aria-checked={filter === f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
                {label}
                {f === "new" && fresh.length > 0 && <span className="count">{fresh.length}</span>}
              </button>
            ))}
          </div>
          <div className="toolbar-actions">
            {linked && fresh.length > 0 && (
              <button disabled={bulk !== null} onClick={() => void sendAllNew()}>
                <Icon name="send" size={14} />
                {bulk ? `Sending ${bulk.done}/${bulk.of}…` : `Send ${fresh.length} new to CRM`}
              </button>
            )}
            <button className="ghost" disabled={all.length === 0} onClick={exportCsv}>
              <Icon name="download" size={14} /> CSV
            </button>
          </div>
        </div>
        {error && <pre className="err">{error}</pre>}
        {responses.error && <pre className="err">{responses.error}</pre>}

        {responses.data && all.length === 0 && (
          <div className="empty-state">
            <p className="empty">No responses yet.</p>
            <p className="meta">Connect a website in the Connect tab, or enter one by hand in Preview.</p>
          </div>
        )}
        {all.length > 0 && shown.length === 0 && <p className="empty">Nothing matches.</p>}

        {shown.length > 0 && (
          <div className="table-wrap">
            <table className="responses">
              <thead>
                <tr>
                  {columns.map((f) => (
                    <th key={f.id}>{f.label}</th>
                  ))}
                  <th>Received</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="response-row" tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(r.id)}>
                    {columns.map((f, i) => (
                      <td key={f.id} className={i === 0 ? "strong" : ""}>
                        {valueOf(r, f.id) || <span className="dim">—</span>}
                      </td>
                    ))}
                    <td className="nowrap" title={fromNanos(r.created_at).toLocaleString()}>
                      {ago(r.created_at)}
                    </td>
                    <td>
                      <StatusBadge r={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {open && (
        <ResponsePanel
          key={open.id}
          form={form}
          response={open}
          workspace={workspace}
          onConnect={onConnect}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

function StatusBadge({ r }: { r: ResponseView }) {
  if (r.crm_deal) return <span className="badge badge-crm">In CRM</span>;
  if (r.archived) return <span className="badge badge-archived">Archived</span>;
  return <span className="badge badge-new">New</span>;
}

/** For each choice question: how the answers split. */
function Summary({ form, responses }: { form: FormView; responses: ResponseView[] }) {
  const choice = form.fields.filter((f) => f.kind === "choice" || f.kind === "checkboxes");
  if (responses.length === 0 || choice.length === 0) return null;
  return (
    <section className="card summary">
      <h2>
        {responses.length} {responses.length === 1 ? "response" : "responses"}
      </h2>
      <div className="summary-grid">
        {choice.map((f) => {
          const counts = new Map(f.options.map((o) => [o, 0]));
          let answered = 0;
          for (const r of responses) {
            const a = r.answers.find((x) => x.field_id === f.id);
            if (!a || a.values.length === 0) continue;
            answered++;
            for (const v of a.values) counts.set(v, (counts.get(v) ?? 0) + 1);
          }
          return (
            <div key={f.id} className="summary-q">
              <h3>{f.label}</h3>
              <p className="meta">
                {answered} {answered === 1 ? "answer" : "answers"}
              </p>
              <ul className="bars">
                {[...counts].map(([option, n]) => {
                  const pct = answered ? Math.round((n / answered) * 100) : 0;
                  return (
                    <li key={option}>
                      <span className="bar-label">{option}</span>
                      <span className="bar-track">
                        <span className="bar-fill" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="bar-value">
                        {n} · {pct}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ResponsePanel({
  form,
  response,
  workspace,
  onConnect,
  onClose,
}: {
  form: FormView;
  response: ResponseView;
  workspace: Workspace;
  onConnect: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"crm" | "archive" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const send = useSendToCrm(workspace);
  const linked = isLinked(form.crm);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  function run(what: "crm" | "archive", fn: () => Promise<unknown>) {
    setBusy(what);
    setError(null);
    fn()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="panel card" role="dialog" aria-label={`response from ${headline(response)}`}>
        <header className="panel-head">
          <div>
            <h2>{headline(response)}</h2>
            <div className="meta">
              Received {ago(response.created_at)} · {fromNanos(response.created_at).toLocaleString()}
              {response.source && (
                <>
                  {" "}
                  · from <span className="mono">{response.source}</span>
                </>
              )}
            </div>
          </div>
          <button className="icon-button" aria-label="close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>

        <dl className="answers">
          {response.answers.map((a) => {
            const removed = !form.fields.some((f) => f.id === a.field_id);
            return (
              <div key={a.field_id} className="answer">
                <dt>
                  {a.label}
                  {removed && <span className="dim"> (no longer on the form)</span>}
                </dt>
                <dd>
                  {a.values.length === 0 ? (
                    <span className="dim">No answer</span>
                  ) : a.kind === "email" ? (
                    <a href={`mailto:${a.values[0]}`}>{a.values[0]}</a>
                  ) : a.kind === "url" ? (
                    <a href={a.values[0]} target="_blank" rel="noreferrer noopener">
                      {a.values[0]}
                    </a>
                  ) : a.kind === "checkboxes" ? (
                    <ul className="ticks">
                      {a.values.map((v) => (
                        <li key={v}>{v}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="answer-text">{a.values[0]}</span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>

        <div className="panel-crm">
          {response.crm_deal ? (
            <p className="ok" data-testid="sent-to-crm">
              <Icon name="check" size={14} /> In Mero CRM as deal <code>{response.crm_deal}</code>, sent{" "}
              {ago(response.crm_sent_at)} by <PersonName account={response.crm_sent_by} />.
            </p>
          ) : linked ? (
            <button disabled={busy !== null} onClick={() => run("crm", () => send(form, response))}>
              <Icon name="send" size={14} /> {busy === "crm" ? "Sending…" : "Send to CRM"}
            </button>
          ) : (
            <p className="meta">
              Connect this form to a Mero CRM pipeline to send responses there.{" "}
              <button className="link" onClick={onConnect}>
                Set it up
              </button>
            </p>
          )}
          <button
            className="ghost"
            disabled={busy !== null}
            onClick={() => run("archive", () => workspace.act((c) => c.setArchived({ id: response.id, archived: !response.archived })))}
          >
            {response.archived ? "Unarchive" : "Archive"}
          </button>
        </div>
        {error && <pre className="err">{error}</pre>}
        <p className="meta panel-foot" title={response.submitted_by}>
          Submitted by {shortAccount(response.submitted_by)}
        </p>
      </aside>
    </div>
  );
}
