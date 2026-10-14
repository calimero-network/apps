import { useState } from "react";
import type { AppView, GroupView } from "../backend";
import type { OrgState } from "../useOrg";
import { Dialog, type PageProps } from "./Shell";

export const JOIN_ONLY = 4;
export const CONTRIBUTOR = 7;

/** Depth-first order with each group's depth; orphans (parent gone) are shown at the root. */
export function treeOrder(groups: GroupView[]): { group: GroupView; depth: number }[] {
  const ids = new Set(groups.map((g) => g.id));
  const kids = new Map<string, GroupView[]>();
  for (const g of groups) {
    const p = g.parent && ids.has(g.parent) ? g.parent : "";
    kids.set(p, [...(kids.get(p) ?? []), g]);
  }
  const out: { group: GroupView; depth: number }[] = [];
  const walk = (parent: string, depth: number) => {
    for (const g of (kids.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) { out.push({ group: g, depth }); walk(g.id, depth + 1); }
  };
  walk("", 0);
  return out;
}

function descendants(id: string, groups: GroupView[]): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const g of groups) if (out.has(g.parent) && !out.has(g.id)) { out.add(g.id); grew = true; } }
  return out;
}

function AccessTick({ state, group, app, editable }: { state: OrgState; group: GroupView; app: AppView; editable: boolean }) {
  const row = state.access.find((a) => a.group === group.id && a.app === app.id);
  const on = !!row && row.enabled;
  const caps = row?.capabilities ?? JOIN_ONLY;
  const [custom, setCustom] = useState(caps !== JOIN_ONLY && caps !== CONTRIBUTOR);
  const [draft, setDraft] = useState(String(caps));
  const set = (n: number) => void state.run((b) => b.setAccess(group.id, app.id, n));
  return (
    <li className="access-tick">
      <label>
        <input type="checkbox" aria-label={app.label} checked={on} disabled={!editable || state.busy}
          onChange={() => void state.run((b) => (on ? b.removeAccess(group.id, app.id) : b.setAccess(group.id, app.id, caps)))} />
        <span aria-hidden="true">{app.label}</span>
      </label>
      {on && (
        <select aria-label="Capability preset" title={`${group.name} · ${app.label}`} disabled={!editable || state.busy}
          value={custom ? "custom" : String(caps)}
          onChange={(e) => { if (e.target.value === "custom") { setCustom(true); return; } setCustom(false); set(Number(e.target.value)); }}>
          <option value={JOIN_ONLY}>Join only</option>
          <option value={CONTRIBUTOR}>Contributor</option>
          <option value="custom">Custom…</option>
        </select>
      )}
      {on && custom && (
        <input type="number" min={0} className="caps-input" aria-label="Custom capabilities" value={draft} disabled={!editable || state.busy}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { const n = Number(draft); if (Number.isInteger(n) && n >= 0 && n !== caps) set(n); }} />
      )}
    </li>
  );
}

type Edit = { kind: "new" } | { kind: "rename"; group: GroupView } | { kind: "delete"; group: GroupView };

export function GroupsPage({ state, isAdmin }: PageProps) {
  const [edit, setEdit] = useState<Edit | null>(null);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const close = () => { setEdit(null); setName(""); setParent(""); };
  const rows = treeOrder(state.groups);

  return (
    <section className="stack">
      <div className="page-head">
        <h1>Groups</h1>
        {isAdmin && <button type="button" className="primary" onClick={() => setEdit({ kind: "new" })}>New group</button>}
      </div>
      {rows.length === 0 && <p className="empty">No groups yet.</p>}
      {rows.map(({ group: g, depth }) => {
        const blocked = descendants(g.id, state.groups);
        return (
          <article key={g.id} className="card group-card" aria-label={g.name} style={{ marginLeft: depth * 24 }}>
            <div className="group-head">
              <h2>{g.name}</h2>
              <span className="muted small-text">{g.member_count} member{g.member_count === 1 ? "" : "s"}</span>
              {isAdmin && (
                <div className="row-actions">
                  <select aria-label={`Parent of ${g.name}`} value={g.parent} disabled={state.busy}
                    onChange={(e) => { const p = e.target.value; void state.run((b) => b.moveGroup(g.id, p)); }}>
                    <option value="">(top level)</option>
                    {state.groups.filter((o) => !blocked.has(o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  <button type="button" className="small" onClick={() => { setName(g.name); setEdit({ kind: "rename", group: g }); }}>Rename</button>
                  <button type="button" className="small" onClick={() => setEdit({ kind: "delete", group: g })}>Delete</button>
                </div>
              )}
            </div>
            {state.apps.length > 0 && (
              <ul className="ticks access-ticks" aria-label={`Apps ${g.name} reaches`}>
                {state.apps.map((a) => <AccessTick key={a.id} state={state} group={g} app={a} editable={isAdmin} />)}
              </ul>
            )}
          </article>
        );
      })}

      {edit?.kind === "new" && (
        <Dialog title="New group" onClose={close}>
          <form className="form" onSubmit={(e) => { e.preventDefault(); const n = name.trim(), p = parent; if (!n) return; close(); void state.run((b) => b.createGroup(n, p)); }}>
            <label>Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label>Parent
              <select value={parent} onChange={(e) => setParent(e.target.value)}>
                <option value="">(top level)</option>
                {rows.map(({ group: o, depth }) => <option key={o.id} value={o.id}>{"  ".repeat(depth) + o.name}</option>)}
              </select>
            </label>
            <div className="row"><button type="submit" className="primary" disabled={!name.trim()}>Create</button><button type="button" onClick={close}>Cancel</button></div>
          </form>
        </Dialog>
      )}
      {edit?.kind === "rename" && (
        <Dialog title="Rename group" onClose={close}>
          <form className="form" onSubmit={(e) => { e.preventDefault(); const n = name.trim(), id = edit.group.id; if (!n) return; close(); void state.run((b) => b.renameGroup(id, n)); }}>
            <label>Name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label>
            <div className="row"><button type="submit" className="primary" disabled={!name.trim()}>Save</button><button type="button" onClick={close}>Cancel</button></div>
          </form>
        </Dialog>
      )}
      {edit?.kind === "delete" && (
        <Dialog title="Delete group" onClose={close}>
          <p>Delete {edit.group.name}? Its members lose the app access it granted on the next reconcile.</p>
          <div className="row">
            <button type="button" className="primary" onClick={() => { const id = edit.group.id; close(); void state.run((b) => b.deleteGroup(id)); }}>Delete</button>
            <button type="button" onClick={close}>Cancel</button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
