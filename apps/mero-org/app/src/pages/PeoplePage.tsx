import { useState } from "react";
import { Link } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { encodeInviteLink } from "../invite-link";
import { messageOf } from "../useOrg";
import { Dialog, type PageProps } from "./Shell";

const INVITE_TTL_S = 24 * 3600;

function statusTone(status: string): string {
  return status === "active" ? "pill-good" : status === "suspended" ? "pill-bad" : status === "enrolled" ? "pill-busy" : "";
}

export function PeoplePage({ state, orgNamespaceId, isAdmin }: PageProps) {
  const { admin } = useMero();
  const [link, setLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  /** Nothing is written to the contract: the link is valid 24 h and a new one is one click. */
  async function createInvite() {
    if (!admin) return;
    setMinting(true); setInviteError(null); setCopied(false);
    try {
      const expiresS = Math.floor(Date.now() / 1000) + INVITE_TTL_S;
      const res = await admin.createNamespaceInvitation(orgNamespaceId, { expirationTimestamp: expiresS });
      if (!("invitation" in res)) throw new Error("unexpected recursive invitation");
      setLink(encodeInviteLink(window.location.origin, { namespaceId: orgNamespaceId, invitation: res.invitation }));
    } catch (e) { setInviteError(messageOf(e)); } finally { setMinting(false); }
  }

  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); }
  }

  const removingMember = state.members.find((m) => m.account === removing);

  return (
    <section className="stack">
      <div className="page-head">
        <h1>People</h1>
        {isAdmin && <button type="button" className="primary" disabled={minting} onClick={() => void createInvite()}>Invite</button>}
      </div>
      {link && (
        <div className="card invite">
          <label className="grow">Invitation link (valid 24 h)
            <input readOnly data-testid="invite-link" value={link} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <button type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
        </div>
      )}
      {inviteError && <p className="err" role="alert">{inviteError}</p>}
      {state.members.length === 0 ? <p className="empty">No one has joined yet.</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Name</th><th>Handle</th><th>Status</th><th>Groups</th><th>Apps</th>{isAdmin && <th><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody>
              {state.members.map((m) => (
                <tr key={m.account}>
                  <td><Link to={`/people/${m.account}`}>{m.display_name || m.account.slice(0, 8)}</Link></td>
                  <td className="muted">{m.handle ? `@${m.handle}` : ""}</td>
                  <td><span className={`pill ${statusTone(m.status)}`}>{m.status}</span></td>
                  <td>{m.groups.length}</td>
                  <td>{m.apps.length}</td>
                  {isAdmin && (
                    <td className="row-actions">
                      {m.status !== "suspended" && m.status !== "left" && <button type="button" className="small" disabled={state.busy} onClick={() => void state.run((b) => b.setMemberStatus(m.account, "suspended"))}>Suspend</button>}
                      {m.status === "suspended" && <button type="button" className="small" disabled={state.busy} onClick={() => void state.run((b) => b.setMemberStatus(m.account, m.groups.length ? "active" : "enrolled"))}>Reactivate</button>}
                      {m.status !== "left" && <button type="button" className="small" disabled={state.busy} onClick={() => setRemoving(m.account)}>Remove</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {removing && (
        <Dialog title="Remove member" onClose={() => setRemoving(null)}>
          <p>Remove {removingMember?.display_name || removing.slice(0, 8)} from the org? Their app access is withdrawn on the next reconcile.</p>
          <div className="row">
            <button type="button" className="primary" onClick={() => { const a = removing; setRemoving(null); void state.run((b) => b.setMemberStatus(a, "left")); }}>Remove</button>
            <button type="button" onClick={() => setRemoving(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
