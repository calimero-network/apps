import { useMemo, useState } from "react";
import type { LeadView, TeamMember } from "./generated/LeadsClient";
import { LeadPanel } from "./LeadPanel";
import {
  BOARD_STATUSES,
  STATUS_LABEL,
  ago,
  byStatus,
  matches,
  toCsv,
  type Status,
} from "./lib/pipeline";
import { PersonName } from "./names";
import { useRead, type Inbox } from "./useInbox";

type View = "board" | "list";

/**
 * The leads, as a pipeline board (one column per status, drag a card to move
 * it) or a list. Opening a lead shows everything about it and lets a teammate
 * edit it.
 */
export function LeadsBoard({ inbox, me }: { inbox: Inbox; me: string | null }) {
  const leads = useRead(inbox.client, inbox.version, (c) => c.listLeads(), []);
  const team = useRead(inbox.client, inbox.version, (c) => c.listTeam(), []);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("board");
  const [showSpam, setShowSpam] = useState(false);
  const [mine, setMine] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      (leads.data ?? []).filter(
        (l) => matches(l, query) && (!mine || (me !== null && l.owner === me)),
      ),
    [leads.data, query, mine, me],
  );
  const groups = useMemo(() => byStatus(visible), [visible]);
  const columns: Status[] = showSpam ? [...BOARD_STATUSES, "spam"] : BOARD_STATUSES;
  const open = leads.data?.find((l) => l.id === openId) ?? null;

  function move(id: string, status: Status) {
    setError(null);
    inbox
      .act((c) => c.setStatus({ id, status }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }

  function exportCsv() {
    const blob = new Blob([toCsv(visible)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="toolbar">
        <input
          className="search"
          aria-label="search leads"
          placeholder="Search name, email, company, message…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="segmented" role="radiogroup" aria-label="view">
          {(["board", "list"] as const).map((v) => (
            <button
              key={v}
              role="radio"
              aria-checked={view === v}
              className={view === v ? "active" : ""}
              onClick={() => setView(v)}
            >
              {v === "board" ? "Board" : "List"}
            </button>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine
        </label>
        <label className="toggle">
          <input type="checkbox" checked={showSpam} onChange={(e) => setShowSpam(e.target.checked)} />{" "}
          Spam
        </label>
        <button className="ghost" onClick={exportCsv} disabled={visible.length === 0}>
          Export CSV
        </button>
      </div>

      {leads.error && <pre className="err">{leads.error}</pre>}
      {error && <pre className="err">{error}</pre>}
      {leads.loading && !leads.data && <p className="empty">Loading leads…</p>}
      {leads.data && leads.data.length === 0 && (
        <div className="card empty-state">
          <h2>No leads yet</h2>
          <p className="empty">
            Leads arrive here from your website&apos;s form. Connect one under <strong>Forms</strong>,
            and every submission lands in <em>New</em>.
          </p>
        </div>
      )}

      {leads.data && leads.data.length > 0 && view === "board" && (
        <div className="board" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(220px, 1fr))` }}>
          {columns.map((status) => (
            <Column
              key={status}
              status={status}
              leads={groups[status]}
              onOpen={setOpenId}
              onDrop={(id) => move(id, status)}
            />
          ))}
        </div>
      )}

      {leads.data && leads.data.length > 0 && view === "list" && (
        <div className="card">
          <table className="lead-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {visible
                .filter((l) => showSpam || l.status !== "spam")
                .map((l) => (
                  <tr key={l.id} onClick={() => setOpenId(l.id)} className="lead-tr">
                    <td>
                      <div className="lead-name">{l.name}</div>
                      <div className="meta">{l.email}</div>
                    </td>
                    <td>{l.company || <span className="dim">—</span>}</td>
                    <td>
                      <span className={`status status-${l.status}`}>{STATUS_LABEL[l.status as Status] ?? l.status}</span>
                    </td>
                    <td>{l.owner ? <PersonName account={l.owner} /> : <span className="dim">—</span>}</td>
                    <td className="meta">{ago(l.created_at)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <LeadPanel
          key={open.id}
          lead={open}
          inbox={inbox}
          team={(team.data ?? []) as TeamMember[]}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

function Column({
  status,
  leads,
  onOpen,
  onDrop,
}: {
  status: Status;
  leads: LeadView[];
  onOpen: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <section
      className={over ? "column over" : "column"}
      aria-label={STATUS_LABEL[status]}
      data-testid={`column-${status}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/lead-id");
        if (id) onDrop(id);
      }}
    >
      <header className="column-head">
        <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>
        <span className="count">{leads.length}</span>
      </header>
      {leads.map((l) => (
        <button
          key={l.id}
          className="lead-card"
          draggable
          onDragStart={(e) => e.dataTransfer.setData("text/lead-id", l.id)}
          onClick={() => onOpen(l.id)}
        >
          <span className="lead-name">{l.name}</span>
          {l.company && <span className="lead-company">{l.company}</span>}
          <span className="lead-snippet">{l.message}</span>
          <span className="meta">
            {ago(l.created_at)}
            {l.owner && (
              <>
                {" · "}
                <PersonName account={l.owner} />
              </>
            )}
          </span>
        </button>
      ))}
      {leads.length === 0 && <p className="column-empty">Drop a lead here</p>}
    </section>
  );
}
