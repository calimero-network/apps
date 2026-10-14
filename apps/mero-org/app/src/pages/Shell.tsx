import { useEffect, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import type { MemberView } from "../backend";
import type { OrgState } from "../useOrg";
import { useReconciler } from "../reconcile/useReconciler";

/** What every page under the shell receives. */
export interface PageProps { state: OrgState; orgNamespaceId: string; myAccount: string; isAdmin: boolean }

/** A member's display name, or the first 8 hex of the account when there is none (or no member row). */
export function nameOf(account: string, members: MemberView[] | Map<string, MemberView>): string {
  const m = members instanceof Map ? members.get(account) : members.find((x) => x.account === account);
  return m?.display_name || account.slice(0, 8);
}

export function AccountName({ account, members }: { account: string; members: MemberView[] }) {
  return <span title={account}>{nameOf(account, members)}</span>;
}

/** A plain modal: a labelled region over a backdrop; Escape or the backdrop closes it. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className="dialog">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 120 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

const NAV: [string, string][] = [["/people", "People"], ["/groups", "Groups"], ["/apps", "Apps"], ["/activity", "Activity"], ["/me", "Me"], ["/settings", "Settings"]];

export function Shell({ state, orgNamespaceId, myAccount, isAdmin, onSwitchOrg, children }: PageProps & { onSwitchOrg: () => void; children: ReactNode }) {
  const rec = useReconciler(state.backend, orgNamespaceId, isAdmin, myAccount);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5_000); return () => clearInterval(t); }, []);
  const failed = rec.lastResult?.failed.length ?? 0;
  const status = rec.running ? "Reconciling…"
    : rec.lastRun == null ? "Not reconciled yet"
    : `Reconciled ${ago(now - rec.lastRun)} · ${rec.lastResult?.applied ?? 0} ops${failed ? ` · ${failed} failed` : ""}`;

  return (
    <>
      <header className="topbar">
        <span className="brand"><span>{state.org?.name || "Mero Org"}</span></span>
        <nav className="topnav" aria-label="Sections">
          {NAV.map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "on" : undefined)}>{label}</NavLink>)}
        </nav>
        <div className="topbar-end">
          {isAdmin && <span className="status-text" title={rec.lastResult?.failed.map((f) => f.error).join("\n") || undefined}>{status}</span>}
          {isAdmin && <button type="button" className="small" disabled={rec.running} onClick={() => void rec.runNow()}>Run now</button>}
          <button type="button" className="small link" onClick={onSwitchOrg}>Switch org</button>
        </div>
      </header>
      <main className="page org-page">
        {state.error && (
          <div className="error" role="alert">
            <span>{state.error}</span>
            <button type="button" className="small" onClick={state.dismissError}>Dismiss</button>
          </div>
        )}
        {children}
      </main>
    </>
  );
}

/** Contract timestamps come from `env::time_now()` (nanoseconds); anything already in ms passes through. */
export function formatTime(t: number): string {
  if (!t) return "";
  return new Date(t > 1e15 ? Math.floor(t / 1e6) : t).toLocaleString();
}
