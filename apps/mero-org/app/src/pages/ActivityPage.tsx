import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppView, GroupView, MemberView } from "../backend";
import type { ActivityRow } from "../generated/MeroOrgClient";
import { messageOf } from "../useOrg";
import { formatTime, nameOf, type PageProps } from "./Shell";

const PAGE = 50;

/** One sentence per activity row. Subjects/objects follow the contract's `record(verb, subject, object, note)` calls. */
export function sentence(row: ActivityRow, membersById: Map<string, MemberView>, groupsById: Map<string, GroupView>, appsById: Map<string, AppView>): string {
  const person = (a: string) => nameOf(a, membersById);
  const group = (id: string) => groupsById.get(id)?.name || id.slice(0, 8);
  const app = (id: string) => appsById.get(id)?.label || id.slice(0, 8);
  const actor = person(row.actor);
  switch (row.verb) {
    case "enrolled": return `${person(row.subject)} joined the org`;
    case "status": return `${actor} set ${person(row.subject)} to ${row.object}`;
    case "group_created": return `${actor} created ${group(row.subject)}`;
    case "group_renamed": return `${actor} renamed ${group(row.subject)}`;
    case "group_moved": return `${actor} moved ${group(row.subject)}`;
    case "group_deleted": return `${actor} deleted ${group(row.subject)}`;
    case "membership_set": return `${actor} added ${person(row.subject)} to ${group(row.object)} as ${row.note}`;
    case "membership_removed": return `${actor} removed ${person(row.subject)} from ${group(row.object)}`;
    case "app_registered": return `${actor} registered ${app(row.subject)}`;
    case "app_removed": return `${actor} removed ${app(row.subject)}`;
    case "access_set": return `${actor} granted ${group(row.subject)} access to ${app(row.object)}`;
    case "access_removed": return `${actor} removed ${group(row.subject)}'s access to ${app(row.object)}`;
    case "enrolment": return `${person(row.subject)} is now ${row.note} in ${app(row.object)}`;
    default: return `${actor} ${row.verb} ${row.subject.slice(0, 8)}`;
  }
}

export function ActivityPage({ state }: PageProps) {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [chain, setChain] = useState<boolean | null>(null);
  const [verifying, setVerifying] = useState(false);
  const membersById = useMemo(() => new Map(state.members.map((m) => [m.account, m])), [state.members]);
  const groupsById = useMemo(() => new Map(state.groups.map((g) => [g.id, g])), [state.groups]);
  const appsById = useMemo(() => new Map(state.apps.map((a) => [a.id, a])), [state.apps]);

  // The newest page, re-read whenever the org's views change (they change on every recorded op).
  const loadNewest = useCallback(async () => {
    try { const p = await state.backend.activity(0, PAGE); setRows(p.rows); setTotal(p.total); setError(null); } catch (e) { setError(messageOf(e)); }
  }, [state.backend]);
  useEffect(() => { void loadNewest(); }, [loadNewest, state.org, state.members, state.groups, state.apps, state.access, state.enrolments]);

  const oldest = rows.length ? Math.min(...rows.map((r) => r.index)) : 0;
  async function older() {
    try { const p = await state.backend.activity(oldest, PAGE); setRows((r) => [...r, ...p.rows]); setTotal(p.total); } catch (e) { setError(messageOf(e)); }
  }

  async function verify() {
    setVerifying(true);
    try { setChain(await state.backend.verifyActivity()); } catch (e) { setError(messageOf(e)); } finally { setVerifying(false); }
  }

  return (
    <section className="stack">
      <div className="page-head">
        <h1>Activity</h1>
        <button type="button" disabled={verifying} onClick={() => void verify()}>Verify chain</button>
        {chain !== null && <span role="status" className={`pill ${chain ? "pill-good" : "pill-bad"}`}>{chain ? "Chain intact" : "Chain broken"}</span>}
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      {rows.length === 0 ? <p className="empty">Nothing has happened yet.</p> : (
        <ol className="activity">
          {rows.map((r) => (
            <li key={r.index}>
              <span>{sentence(r, membersById, groupsById, appsById)}</span>
              <time className="muted small-text">{formatTime(r.at)}</time>
            </li>
          ))}
        </ol>
      )}
      {rows.length > 0 && oldest > 0 && rows.length < total && <button type="button" onClick={() => void older()}>Older</button>}
    </section>
  );
}
