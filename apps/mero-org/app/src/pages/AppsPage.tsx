import { useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import type { AdminApiClient } from "@calimero-network/mero-js";
import type { AppView } from "../backend";
import { messageOf } from "../useOrg";
import { Dialog, type PageProps } from "./Shell";

/** The reconciler acts in an app's namespace as the signed-in account, so it must be an Admin there. */
export async function isNamespaceAdmin(admin: Pick<AdminApiClient, "listGroupMembers">, namespaceId: string, myAccount: string): Promise<boolean> {
  try {
    const { members } = await admin.listGroupMembers(namespaceId);
    return members.find((m) => m.identity === myAccount)?.role === "Admin";
  } catch {
    return false;
  }
}

const EMPTY = { namespaceId: "", package: "", label: "" };

export function AppsPage({ state, myAccount, isAdmin }: PageProps) {
  const { admin } = useMero();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [notice, setNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [removing, setRemoving] = useState<AppView | null>(null);

  async function register() {
    if (!admin) return;
    setChecking(true);
    try {
      const f = { namespaceId: form.namespaceId.trim(), package: form.package.trim(), label: form.label.trim() };
      const ready = await isNamespaceAdmin(admin, f.namespaceId, myAccount);
      setOpen(false); setForm(EMPTY);
      const out = await state.run((b) => b.registerApp({ ...f, status: ready ? "ready" : "pending_admin" }));
      if (out) setNotice(ready ? null : `You are not an admin of ${f.label}'s namespace yet. Ask its admin to make you one, then press Recheck; until then the org cannot place anyone there.`);
    } catch (e) { setNotice(messageOf(e)); } finally { setChecking(false); }
  }

  async function recheck(a: AppView) {
    if (!admin) return;
    const ready = await isNamespaceAdmin(admin, a.id, myAccount);
    if (ready) { setNotice(null); await state.run((b) => b.setAppStatus(a.id, "ready")); }
    else setNotice(`Still not an admin of ${a.label}'s namespace.`);
  }

  return (
    <section className="stack">
      <div className="page-head">
        <h1>Apps</h1>
        {isAdmin && <button type="button" className="primary" onClick={() => setOpen(true)}>Register</button>}
      </div>
      {notice && <p className="notice" role="status">{notice}</p>}
      {state.apps.length === 0 ? <p className="empty">No apps registered yet.</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Label</th><th>Package</th><th>Namespace</th><th>Status</th><th>Groups</th>{isAdmin && <th><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody>
              {state.apps.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.label}</strong></td>
                  <td className="mono">{a.package}</td>
                  <td className="mono" title={a.id}>{a.id.slice(0, 12)}…</td>
                  <td><span className={`pill ${a.status === "ready" ? "pill-good" : "pill-wait"}`}>{a.status === "ready" ? "ready" : "needs admin"}</span></td>
                  <td>{a.group_count}</td>
                  {isAdmin && (
                    <td className="row-actions">
                      {a.status !== "ready" && <button type="button" className="small" disabled={state.busy} onClick={() => void recheck(a)}>Recheck</button>}
                      <button type="button" className="small" disabled={state.busy} onClick={() => setRemoving(a)}>Remove</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <Dialog title="Register an app" onClose={() => setOpen(false)}>
          <form className="form" onSubmit={(e) => { e.preventDefault(); void register(); }}>
            <label>Namespace id<input className="mono" value={form.namespaceId} onChange={(e) => setForm({ ...form, namespaceId: e.target.value })} /></label>
            <label>Package<input value={form.package} placeholder="com.calimero.example" onChange={(e) => setForm({ ...form, package: e.target.value })} /></label>
            <label>Label<input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
            <div className="row">
              <button type="submit" className="primary" disabled={checking || !form.namespaceId.trim() || !form.package.trim() || !form.label.trim()}>Register app</button>
              <button type="button" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </form>
        </Dialog>
      )}
      {removing && (
        <Dialog title="Remove app" onClose={() => setRemoving(null)}>
          <p>Remove {removing.label}? Groups stop reaching it; nobody is taken out of its namespace.</p>
          <div className="row">
            <button type="button" className="primary" onClick={() => { const id = removing.id; setRemoving(null); void state.run((b) => b.removeApp(id)); }}>Remove</button>
            <button type="button" onClick={() => setRemoving(null)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
