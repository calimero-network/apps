import { useEffect, useState } from "react";
import { AccountName, type PageProps } from "./Shell";

export function SettingsPage({ state, myAccount, isAdmin }: PageProps) {
  const admins = state.org?.admins ?? [];
  const [form, setForm] = useState({ name: "", icon: "" });
  const [grantee, setGrantee] = useState("");
  useEffect(() => { setForm({ name: state.org?.name ?? "", icon: state.org?.icon ?? "" }); }, [state.org?.name, state.org?.icon]);
  const candidates = state.members.filter((m) => !admins.includes(m.account) && m.status !== "left");

  return (
    <section className="stack">
      <h1>Settings</h1>
      <form className="form card-form" onSubmit={(e) => { e.preventDefault(); const f = { name: form.name.trim(), icon: form.icon.trim() }; void state.run((b) => b.setSettings(f.name, f.icon)); }}>
        <label>Org name<input value={form.name} disabled={!isAdmin} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>Icon URL<input value={form.icon} disabled={!isAdmin} onChange={(e) => setForm({ ...form, icon: e.target.value })} /></label>
        {isAdmin && <div className="row"><button type="submit" className="primary" disabled={state.busy || !form.name.trim()}>Save settings</button></div>}
      </form>

      <h2>Admins</h2>
      <ul className="admins">
        {admins.map((a) => (
          <li key={a} className="card">
            <span className="grow"><AccountName account={a} members={state.members} />{a === myAccount && <span className="muted"> (you)</span>}</span>
            {isAdmin && <button type="button" className="small" disabled={state.busy || admins.length <= 1} title={admins.length <= 1 ? "The org needs at least one admin" : undefined}
              onClick={() => void state.run((b) => b.revokeAdmin(a))}>Revoke</button>}
          </li>
        ))}
      </ul>
      {isAdmin && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); const g = grantee; if (!g) return; setGrantee(""); void state.run((b) => b.grantAdmin(g)); }}>
          <label>Member
            <select value={grantee} onChange={(e) => setGrantee(e.target.value)}>
              <option value="">Choose a member…</option>
              {candidates.map((m) => <option key={m.account} value={m.account}>{m.display_name || m.account.slice(0, 8)}</option>)}
            </select>
          </label>
          <button type="submit" disabled={!grantee || state.busy}>Grant admin</button>
        </form>
      )}
    </section>
  );
}
