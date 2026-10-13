import { Link, useParams } from "react-router-dom";
import { formatTime as when, type PageProps } from "./Shell";

export function PersonPage({ state, isAdmin }: PageProps) {
  const { account = "" } = useParams();
  const member = state.members.find((m) => m.account === account);
  if (!member) return <section className="stack"><Link to="/people">← People</Link><p className="empty">No member {account.slice(0, 8)}.</p></section>;
  const enrolments = state.enrolments.filter((e) => e.account === account);
  const appLabel = (id: string) => state.apps.find((a) => a.id === id)?.label ?? id.slice(0, 8);

  return (
    <section className="stack">
      <Link to="/people">← People</Link>
      <div className="page-head">
        <h1>{member.display_name || account.slice(0, 8)}</h1>
        <span className="pill">{member.status}</span>
      </div>
      <dl className="facts-list">
        <dt>Handle</dt><dd>{member.handle ? `@${member.handle}` : "—"}</dd>
        <dt>Account</dt><dd className="mono">{account}</dd>
        <dt>Joined</dt><dd>{when(member.joined_at)}</dd>
      </dl>

      <h2>Groups</h2>
      {state.groups.length === 0 ? <p className="muted">No groups yet.</p> : (
        <ul className="ticks">
          {state.groups.map((g) => {
            const inGroup = member.groups.includes(g.id);
            return (
              <li key={g.id}>
                <label>
                  <input type="checkbox" checked={inGroup} disabled={!isAdmin || state.busy}
                    onChange={() => void state.run((b) => (inGroup ? b.removeMembership(g.id, account) : b.setMembership(g.id, account, "member")))} />
                  {g.name}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <h2>App enrolment</h2>
      {enrolments.length === 0 ? <p className="muted">Not enrolled in any app yet.</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>App</th><th>State</th><th>Subgroups</th><th>Note</th><th>Updated</th>{isAdmin && <th><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody>
              {enrolments.map((e) => (
                <tr key={e.app}>
                  <td>{appLabel(e.app)}</td>
                  <td><span className={`pill ${e.state === "placed" ? "pill-good" : e.state === "failed" ? "pill-bad" : e.state === "invitation_pending" ? "pill-wait" : ""}`}>{e.state}</span></td>
                  <td>{e.subgroups.length}</td>
                  <td className="muted">{e.note}</td>
                  <td className="muted">{when(e.updated_at)}</td>
                  {isAdmin && (
                    <td>
                      {/* Back to not_enrolled: the reconciler's next run mints a fresh invitation. */}
                      <button type="button" className="small" disabled={state.busy}
                        onClick={() => void state.run((b) => b.recordEnrolment({ account, app: e.app, state: "not_enrolled", invitation: "", invitationExpires: 0, subgroups: e.subgroups, note: "" }))}>Re-mint</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
