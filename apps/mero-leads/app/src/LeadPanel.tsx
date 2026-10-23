import { useEffect, useState } from "react";
import type { LeadChanges, LeadView, TeamMember } from "./generated/LeadsClient";
import { STATUSES, STATUS_LABEL, ago, fromNanos, nextStatus, type Status } from "./lib/pipeline";
import { displayName } from "./lib/people";
import { PersonName, useSpaceNames } from "./names";
import type { Inbox } from "./useInbox";

/** Every field absent: the contract leaves a `null` field as it is. */
const NO_CHANGES: LeadChanges = {
  status: null,
  notes: null,
  owner: null,
  name: null,
  email: null,
  company: null,
};

/**
 * One lead, in full, with the team's working state editable.
 *
 * What the visitor sent is shown as sent and can never change: the contract
 * keeps it write-once. Corrections to the name, email or company are an
 * overlay, shown beside the original, and clearing one goes back to it.
 */
export function LeadPanel({
  lead,
  inbox,
  team,
  onClose,
}: {
  lead: LeadView;
  inbox: Inbox;
  team: TeamMember[];
  onClose: () => void;
}) {
  const [name, setName] = useState(lead.name);
  const [email, setEmail] = useState(lead.email);
  const [company, setCompany] = useState(lead.company);
  const [notes, setNotes] = useState(lead.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { nameOf } = useSpaceNames();

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  /** Only what moved, so a save never overwrites a teammate's edit to another field. */
  function changes(): Partial<LeadChanges> {
    const c: Partial<LeadChanges> = {};
    if (name.trim() !== lead.name) c.name = name.trim() === lead.original_name ? "" : name;
    if (email.trim() !== lead.email) c.email = email.trim() === lead.original_email ? "" : email;
    if (company.trim() !== lead.company) c.company = company.trim() === lead.original_company ? "" : company;
    if (notes !== lead.notes) c.notes = notes;
    return c;
  }
  const dirty = Object.keys(changes()).length > 0;

  function save(extra: Partial<LeadChanges> = {}) {
    setBusy(true);
    setError(null);
    inbox
      .act((c) => c.updateLead({ id: lead.id, changes: { ...NO_CHANGES, ...changes(), ...extra } }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }

  const next = nextStatus(lead.status);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="panel card" role="dialog" aria-label={`lead ${lead.name}`}>
        <header className="panel-head">
          <div>
            <h2>{lead.name}</h2>
            <div className="meta">
              Received {ago(lead.created_at)} · {fromNanos(lead.created_at).toLocaleString()}
              {lead.source && <> · from <span className="mono">{lead.source}</span></>}
            </div>
          </div>
          <button className="ghost" aria-label="close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="status-row" role="radiogroup" aria-label="status">
          {STATUSES.map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={lead.status === s}
              className={lead.status === s ? `status-pick active status-${s}` : "status-pick"}
              disabled={busy}
              onClick={() => lead.status !== s && save({ status: s })}
            >
              {STATUS_LABEL[s as Status]}
            </button>
          ))}
        </div>
        {next && (
          <button className="move-on" disabled={busy} onClick={() => save({ status: next })}>
            Move to {STATUS_LABEL[next]} →
          </button>
        )}

        <h3>Message</h3>
        <p className="message">{lead.message}</p>

        <h3>Contact</h3>
        <div className="fields">
          <Field label="Name" value={name} onChange={setName} original={lead.original_name} />
          <Field label="Email" value={email} onChange={setEmail} original={lead.original_email} type="email" />
          <Field label="Company" value={company} onChange={setCompany} original={lead.original_company} />
        </div>

        <h3>Owner</h3>
        <select
          aria-label="owner"
          value={lead.owner}
          disabled={busy}
          onChange={(e) => save({ owner: e.target.value })}
        >
          <option value="">Nobody yet</option>
          {team.map((m) => (
            <option key={m.account} value={m.account}>
              {displayName(m.account, null, nameOf(m.account))}
              {m.admin ? " (admin)" : ""}
            </option>
          ))}
        </select>

        <h3>Notes</h3>
        <textarea
          aria-label="notes"
          rows={5}
          maxLength={10_000}
          value={notes}
          placeholder="Calls, next steps, anything the team should know"
          onChange={(e) => setNotes(e.target.value)}
        />

        {error && <pre className="err">{error}</pre>}
        <div className="row panel-actions">
          <button disabled={!dirty || busy} onClick={() => save()}>
            {busy ? "Saving…" : "Save changes"}
          </button>
          <a className="button ghost" href={`mailto:${encodeURIComponent(lead.email)}`}>
            Email {lead.name.split(" ")[0]}
          </a>
          {lead.updated_at > 0 && (
            <span className="meta">
              Last changed {ago(lead.updated_at)} by <PersonName account={lead.updated_by} />
            </span>
          )}
        </div>
      </aside>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  original,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  original: string;
  type?: string;
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label.toLowerCase()} />
      {value.trim() !== original && original && <span className="hint">Sent as: {original}</span>}
    </label>
  );
}
