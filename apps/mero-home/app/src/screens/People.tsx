import { useEffect, useState } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";

import {
  accessCell,
  appsOf,
  displayName,
  isAdmin,
  loadRosters,
  roleLabel,
  type Cell,
  type OrgView,
  type Person,
  type Rosters,
} from "../home";

const CELL_TEXT: Record<Cell, string> = {
  all: "Yes (everyone)",
  lead: "Lead",
  member: "Yes",
  readOnly: "Read only",
  none: "No",
  unknown: "Not shown",
};

export interface PeopleProps {
  client: Pick<CalimeroClient, "getTeam" | "removeMember">;
  view: OrgView;
  account: string;
  passkey: () => PasskeyProvider;
  after: () => void;
  /** After a removal: the org is read again. */
  onChanged: () => void;
}

/**
 * The organization's people and, per app, who is in it. Core decides who
 * appears (decision 2): an admin sees everyone; in a shared org a member sees
 * the people sharing an app with them, and the org's admins. Guests get no
 * People screen at all (decision 3, `screensFor`).
 *
 * An admin can remove someone from the organization, which takes them out of
 * every app in it (decision 6, core#4891): a separate, confirmed action.
 */
export function People({ client, view, account, passkey, after, onChanged }: PeopleProps) {
  const [rosters, setRosters] = useState<Rosters>(new Map());
  const [removing, setRemoving] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const admin = isAdmin(view.role);

  useEffect(() => {
    let live = true;
    loadRosters(client, view.org, view.apps)
      .then((r) => live && setRosters(r))
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, view, after]);

  const mayRemove = (p: Person) =>
    admin && p.account !== account && (p.role !== "owner" || view.role === "owner");

  async function remove(p: Person) {
    setBusy(true);
    setError(null);
    try {
      await client.removeMember(view.org, p.account, passkey());
      setNotice(`${displayName(p)} was removed from ${view.name} and from every app in it.`);
      setRemoving(null);
      onChanged();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
      after();
    }
  }

  const leaving = removing ? appsOf(view, rosters, removing) : [];

  return (
    <section className="home-card" aria-label="People">
      <h2>People</h2>
      <p className="home-muted">
        {admin
          ? "Everyone in the organization, and the apps each person is in."
          : view.mode === "shared"
            ? "The people who share an app with you, and the organization's admins."
            : "Everyone in the organization."}
      </p>
      {notice && (
        <p className="home-notice" role="status" data-testid="people-notice">
          {notice}
        </p>
      )}
      <div className="home-scroll">
        <table className="home-table" data-testid="people-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              {view.apps.map((a) => (
                <th key={a.package} scope="col">
                  {a.name}
                </th>
              ))}
              {admin && <th scope="col" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {view.people.map((p) => (
              <tr key={p.account} data-testid={`person-${p.account}`}>
                <th scope="row" title={p.account}>
                  {displayName(p)}
                  {p.account === account ? " (you)" : ""}
                </th>
                <td>{roleLabel(p.role)}</td>
                {view.apps.map((a) => {
                  const cell = accessCell(view, a, rosters, p);
                  return (
                    <td key={a.package} className={`home-cell home-cell--${cell}`}>
                      {CELL_TEXT[cell]}
                    </td>
                  );
                })}
                {admin && (
                  <td>
                    {mayRemove(p) && (
                      <button
                        className="glass-btn home-danger"
                        data-testid={`remove-${p.account}`}
                        onClick={() => {
                          setError(null);
                          setRemoving(p);
                        }}
                      >
                        Remove from organization…
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {removing && (
        <div className="home-confirm glass-float" role="alertdialog" aria-labelledby="remove-title" data-testid="remove-confirm">
          <h3 id="remove-title">Remove {displayName(removing)} from {view.name}?</h3>
          <p>
            This removes them from the organization <strong>and from every app in it</strong>
            {leaving.length > 0 ? `: ${leaving.map((a) => a.name).join(", ")}` : ""}. To take someone
            out of one app only, remove them in that app instead.
          </p>
          {error && (
            <p className="home-error" role="alert">
              {error}
            </p>
          )}
          <div className="home-row">
            <button
              className="glass-btn glass-btn--primary home-danger"
              disabled={busy}
              data-testid="remove-confirm-yes"
              onClick={() => void remove(removing)}
            >
              {busy ? "Removing…" : "Remove from organization and all apps"}
            </button>
            <button className="glass-btn" disabled={busy} onClick={() => setRemoving(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
