import { useEffect, useState } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { createAppTeam, describeError, membersMayInvite, packageTitle, setMembersMayInvite } from "@calimero-apps/connect";

import { audience, installable, openLink, type OrgApp, type OrgView } from "../home";

export interface AdminAppsProps {
  client: Pick<CalimeroClient, "packages" | "scopeApps" | "setTeamDefaultCapabilities">;
  view: OrgView;
  passkey: () => PasskeyProvider;
  after: () => void;
  /** After a change the node accepted: the org is read again. */
  onChanged: () => void;
}

type Packages = { kind: "loading" } | { kind: "ready"; packages: string[] } | { kind: "failed"; error: string };

/**
 * The Admin screen (owners and admins: decision 4, only admins install
 * apps): the org's apps with their access and the "members may invite"
 * switch, giving a legacy app its own access list, and adding an app (its
 * app team, shared or for everyone). Home never creates an app's instances:
 * the app does, with its own init, when it is opened from here.
 */
export function AdminApps({ client, view, passkey, after, onChanged }: AdminAppsProps) {
  const [packages, setPackages] = useState<Packages>({ kind: "loading" });
  const [pkg, setPkg] = useState("");
  const [shared, setShared] = useState(view.mode === "shared" || view.apps.some((a) => a.team));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ package: string; teamId: string } | null>(null);

  useEffect(() => {
    let live = true;
    client
      .packages()
      .then((list) => live && setPackages({ kind: "ready", packages: installable(list, view) }))
      .catch((e) => live && setPackages({ kind: "failed", error: describeError(e) }))
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, view, after]);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
      after();
    }
  }

  const toggleInvite = (app: OrgApp, on: boolean) =>
    run(`invite-${app.package}`, async () => {
      if (!app.team) return;
      await setMembersMayInvite(client, view.org, app.team, on, passkey());
    });

  // A legacy app (organization access) gets its own team, open, with everyone
  // who reaches it now: nobody loses access.
  const scopeLegacy = (app: OrgApp) =>
    run(`scope-${app.package}`, async () => {
      await createAppTeam(client, view.org, app.package, passkey(), { name: app.name, shared: false });
    });

  const add = () =>
    run(`add-${pkg}`, async () => {
      const made = await createAppTeam(client, view.org, pkg, passkey(), {
        name: packageTitle(pkg),
        instances: [],
        shared,
      });
      setAdded({ package: made.package, teamId: made.teamId });
      setPkg("");
    });

  const openTeams = view.apps.filter((a) => a.team && a.team.join === "everyone");

  return (
    <section className="home-card" aria-label="Admin">
      <h2>Apps in this organization</h2>
      {view.apps.length === 0 ? (
        <p className="home-muted">No apps yet.</p>
      ) : (
        <ul className="home-list" data-testid="admin-apps">
          {view.apps.map((a) => (
            <li key={a.package} className="home-app" data-testid={`admin-app-${a.package}`}>
              <div>
                <strong>{a.name}</strong>
                <span className="home-muted"> · {audience(a)}</span>
                {a.team ? (
                  <label className="home-check">
                    <input
                      type="checkbox"
                      checked={membersMayInvite(a.team)}
                      disabled={busy !== null}
                      onChange={(e) => void toggleInvite(a, e.target.checked)}
                      data-testid={`members-invite-${a.package}`}
                    />
                    Members may invite others to {a.name}
                  </label>
                ) : (
                  <p className="home-muted">
                    Everyone in the organization reaches it. Give it its own access list to choose who has it;
                    everyone who has it now keeps it.
                  </p>
                )}
              </div>
              {!a.team && (
                <button
                  className="glass-btn"
                  disabled={busy !== null}
                  onClick={() => void scopeLegacy(a)}
                  data-testid={`scope-${a.package}`}
                >
                  Give {a.name} its own access list
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2>Add an app</h2>
      {packages.kind === "loading" && <p className="home-muted">Reading the apps this cluster has…</p>}
      {packages.kind === "failed" && (
        <p className="home-error" role="alert">
          {packages.error}
        </p>
      )}
      {packages.kind === "ready" && packages.packages.length === 0 && (
        <p className="home-muted" data-testid="nothing-to-add">
          Every app this cluster has is in this organization already.
        </p>
      )}
      {packages.kind === "ready" && packages.packages.length > 0 && (
        <form
          className="home-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (pkg) void add();
          }}
        >
          <label className="home-field">
            <span>App</span>
            <select value={pkg} onChange={(e) => setPkg(e.target.value)} data-testid="add-app-package">
              <option value="">Choose…</option>
              {packages.packages.map((p) => (
                <option key={p} value={p}>
                  {packageTitle(p)}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Who gets it</legend>
            <label className="home-check">
              <input type="radio" name="who" checked={shared} onChange={() => setShared(true)} data-testid="add-app-shared" />
              Only the people you add (each app lists its own people)
            </label>
            <label className="home-check">
              <input type="radio" name="who" checked={!shared} onChange={() => setShared(false)} data-testid="add-app-everyone" />
              Everyone in the organization
            </label>
          </fieldset>
          {shared && openTeams.length > 0 && (
            <p className="home-notice" data-testid="add-app-closes">
              {openTeams.map((a) => a.name).join(", ")} will become invite-only. Everyone who has{" "}
              {openTeams.length === 1 ? "it" : "them"} now keeps access.
            </p>
          )}
          <button type="submit" className="glass-btn glass-btn--primary" disabled={!pkg || busy !== null} data-testid="add-app">
            {busy?.startsWith("add-") ? "Adding…" : "Add app"}
          </button>
        </form>
      )}
      {added && (
        <p className="home-notice" role="status" data-testid="app-added">
          {packageTitle(added.package)} is set up. You lead it.{" "}
          <a href={openLink(added.package, view.org, added.teamId)}>Open {packageTitle(added.package)}</a> to start using
          it here.
        </p>
      )}
      {error && (
        <p className="home-error" role="alert" data-testid="admin-error">
          {error}
        </p>
      )}
    </section>
  );
}
