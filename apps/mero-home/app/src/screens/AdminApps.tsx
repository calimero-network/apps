import { useEffect, useState } from "react";
import { passkeyConfirm, type PasskeyProvider } from "@calimero-network/mero-js";
import {
  appTeamInstances,
  createAppTeam,
  describeError,
  keepAppsApart,
  membersMayInvite,
  openAppTeam,
  packageTitle,
  setMembersMayInvite,
  type AppTeamInstance,
  type ClientRoutes,
  type MyOrg,
} from "@calimero-apps/connect";

import {
  audience,
  installable,
  openLink,
  orgName,
  runEach,
  teamsByJoin,
  typedMatches,
  type OrgApp,
  type OrgView,
} from "../home";
import { moveApp, moveTargets } from "../move";

export interface AdminAppsProps {
  client: ClientRoutes<{
    apps: "move";
    packages: "list";
    orgs: "appTeamsScope" | "capabilities" | "teamUpdate" | "teamGet" | "teamDelete";
  }>;
  view: OrgView;
  /** The caller's organizations, for "Move to another organization". */
  orgs?: readonly MyOrg[];
  /** Whether the node moves apps between organizations (core's `/apps/{app}/move`). */
  canMove?: boolean;
  passkey: () => PasskeyProvider;
  after: () => void;
  /** After a change the node accepted: the org is read again. */
  onChanged: () => void;
}

type Packages = { kind: "loading" } | { kind: "ready"; packages: string[] } | { kind: "failed"; error: string };

/** "Remove app": the instances it deletes, read before the confirm opens. */
type Removing =
  | { app: OrgApp; stage: "reading" }
  | { app: OrgApp; stage: "confirm"; instances: AppTeamInstance[]; typed: string };

type Apart = { stage: "confirm"; on: boolean } | { stage: "running"; on: boolean; done: number; total: number } | null;

/**
 * The Admin screen (owners and admins: decision 4, only admins install
 * apps): the org-wide "Keep apps apart" switch, the org's apps with their
 * access and the "members may invite" switch, giving a legacy app its own
 * access list, and adding an app. Home never creates an app's instances: the
 * app does, with its own init, when it is opened from here.
 *
 * Everyone in the organization gets every app until an admin turns "Keep
 * apps apart" on, however many apps it holds: an install and "its own access
 * list" pass `shared: false`, unless the org keeps apps apart already, where
 * they match it (`shared: true`). Turning the switch on closes every app team
 * in one `ScopeApps` (one passkey), and core writes everyone who has each app
 * now into its list, so nobody is locked out. Turning it off opens every app
 * team (`updateTeam`, no passkey), which only widens. One app can be opened
 * on its own; one cannot be closed on its own, since core has no per-app
 * close that keeps its people.
 *
 * "Remove app" deletes an app's team with every instance on it and below it,
 * and their data (`deleteTeam`): the confirm lists those instances, read
 * from the node first, and the admin types the app's name; core then asks
 * for a passkey (none when there is no instance to delete). A legacy app has
 * no team to delete, so it is not offered there.
 */
export function AdminApps({ client, view, orgs = [], canMove = false, passkey, after, onChanged }: AdminAppsProps) {
  const [packages, setPackages] = useState<Packages>({ kind: "loading" });
  const [pkg, setPkg] = useState("");
  const { closed, open, legacy } = teamsByJoin(view);
  /** "Keep apps apart": on once any app lists its own people (the org's mode is `shared`). */
  const apart = closed.length > 0;
  const [confirmApart, setConfirmApart] = useState<Apart>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ package: string; teamId: string } | null>(null);
  const [removing, setRemoving] = useState<Removing | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  // "Move to another organization…": the instance it is open for, and its choices.
  const [moving, setMoving] = useState<{ app: string; to: string; bring: boolean } | null>(null);
  const [movedTo, setMovedTo] = useState<{ name: string; org: string } | null>(null);
  const targets = canMove ? moveTargets(orgs, view.org) : [];

  useEffect(() => {
    let live = true;
    client.packages
      .list()
      .then(({ packages: list }) => live && setPackages({ kind: "ready", packages: installable(list, view) }))
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

  // A legacy app (organization access) gets its own team with everyone who
  // reaches it now: nobody loses access. Open, unless the org keeps apps apart.
  const scopeLegacy = (app: OrgApp) =>
    run(`scope-${app.package}`, async () => {
      await createAppTeam(client, view.org, app.package, passkey(), { name: app.name, shared: apart });
    });

  const moveOne = (app: string, name: string, to: string, bring: boolean) =>
    run(`move-${app}`, async () => {
      await moveApp(client, app, to, bring, passkey());
      setMoving(null);
      setMovedTo({ name, org: orgs.find((o) => o.orgId === to)?.name || to });
    });

  const add = () =>
    run(`add-${pkg}`, async () => {
      const made = await createAppTeam(client, view.org, pkg, passkey(), {
        name: packageTitle(pkg),
        instances: [],
        shared: apart,
      });
      setAdded({ package: made.package, teamId: made.teamId });
      setPkg("");
    });

  async function askRemove(app: OrgApp) {
    if (!app.team) return;
    setError(null);
    setRemoved(null);
    setRemoving({ app, stage: "reading" });
    try {
      const instances = await appTeamInstances(client, view.org, app.team.teamId);
      setRemoving({ app, stage: "confirm", instances, typed: "" });
    } catch (e) {
      setRemoving(null);
      setError(describeError(e));
    } finally {
      after();
    }
  }

  const openOne = (app: OrgApp) =>
    run(`open-${app.package}`, async () => {
      if (app.team) await openAppTeam(client, view.org, app.team);
    });

  async function setApart(on: boolean) {
    setBusy("apart");
    setError(null);
    try {
      if (on) {
        setConfirmApart({ stage: "running", on, done: 0, total: 1 });
        await keepAppsApart(client, view.org, passkey());
      } else {
        setConfirmApart({ stage: "running", on, done: 0, total: closed.length });
        const result = await runEach(
          closed,
          (a) => openAppTeam(client, view.org, a.team!),
          (done) => setConfirmApart({ stage: "running", on, done, total: closed.length }),
        );
        if (result.done.length > 0) onChanged();
        if (result.failed) {
          const left = [result.failed.app, ...result.notTried].map((a) => a.name).join(", ");
          throw new Error(`${describeError(result.failed.error)} Still listing their own people: ${left}.`);
        }
      }
      setConfirmApart(null);
      onChanged();
    } catch (e) {
      setConfirmApart(null);
      setError(describeError(e));
    } finally {
      setBusy(null);
      after();
    }
  }

  const remove = (app: OrgApp) =>
    run(`remove-${app.package}`, async () => {
      if (!app.team) return;
      await client.orgs.teamDelete({ org: view.org, team: app.team.teamId }, { confirm: passkeyConfirm(passkey()) });
      setRemoving(null);
      setRemoved(app.name);
    });

  const people = (a: OrgApp) => (a.team ? ` (${a.team.memberCount} ${a.team.memberCount === 1 ? "person" : "people"})` : "");

  return (
    <section className="home-card" aria-label="Admin">
      <h2>Who gets which app</h2>
      <div className="home-row home-org">
        <p data-testid="apart-state">
          <strong>{apart ? "Each app lists who is in it" : "Everyone in the organization has every app"}</strong>
          {apart && open.length > 0 && (
            <span className="home-muted"> · open to everyone: {open.map((a) => a.name).join(", ")}</span>
          )}
        </p>
        <label className="home-check">
          <input
            type="checkbox"
            role="switch"
            checked={apart}
            disabled={busy !== null || confirmApart !== null || (!apart && open.length === 0)}
            onChange={(e) => setConfirmApart({ stage: "confirm", on: e.target.checked })}
            data-testid="apart-switch"
          />
          Keep apps apart
        </label>
      </div>
      {!apart && open.length === 0 && (
        <p className="home-muted" data-testid="apart-nothing">
          {legacy.length > 0
            ? "Give an app its own access list below to choose who has it."
            : "Add an app first."}
        </p>
      )}
      {confirmApart?.stage === "confirm" && confirmApart.on && (
        <div className="home-confirm glass-float" role="alertdialog" aria-labelledby="apart-title" data-testid="apart-confirm">
          <h3 id="apart-title">Keep apps apart?</h3>
          <p>
            Each app will list who is in it. <strong>Someone who joins the organization from now on gets only the apps
            their invitation names.</strong> &quot;Members may invite&quot; is turned off on every app.
          </p>
          <p data-testid="apart-keeps">
            Nobody is locked out: every current member is written into the list of every app they have now, in the
            same step: {open.map((a) => `${a.name}${people(a)}`).join(", ")}. Guests keep only the apps they were added
            to, and anyone taken out of an app before stays out.
          </p>
          {legacy.length > 0 && (
            <p className="home-muted">
              {legacy.map((a) => a.name).join(", ")} keep{legacy.length === 1 ? "s" : ""} organization access until you
              give {legacy.length === 1 ? "it" : "them"} an access list of {legacy.length === 1 ? "its" : "their"} own.
            </p>
          )}
          <p className="home-muted">Your passkey is asked once.</p>
          <div className="home-row">
            <button className="glass-btn glass-btn--primary" onClick={() => void setApart(true)} data-testid="apart-confirm-yes">
              Keep apps apart
            </button>
            <button className="glass-btn" onClick={() => setConfirmApart(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {confirmApart?.stage === "confirm" && !confirmApart.on && (
        <div className="home-confirm glass-float" role="alertdialog" aria-labelledby="apart-title" data-testid="apart-confirm">
          <h3 id="apart-title">Give everyone every app?</h3>
          <p>
            Everyone in the organization gets {closed.map((a) => a.name).join(", ")}, and everyone who joins later gets
            every app. Nobody loses an app. Guests keep only the apps they were added to, and anyone taken out of an app
            before stays out.
          </p>
          <p className="home-muted">No passkey is asked.</p>
          <div className="home-row">
            <button className="glass-btn glass-btn--primary" onClick={() => void setApart(false)} data-testid="apart-confirm-yes">
              Give everyone every app
            </button>
            <button className="glass-btn" onClick={() => setConfirmApart(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {confirmApart?.stage === "running" && (
        <p role="status" data-testid="apart-progress">
          {confirmApart.on
            ? "Keeping apps apart: confirm with your passkey…"
            : `${confirmApart.done} of ${confirmApart.total} apps opened…`}
        </p>
      )}

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
                    {apart && open.length > 0
                      ? ` This also makes ${open.map((x) => x.name).join(", ")} list ${open.length === 1 ? "its" : "their"} own people again (they keep everyone).`
                      : ""}
                  </p>
                )}
                {targets.length > 0 && a.instances.length > 0 && (
                  <ul className="home-list" data-testid={`instances-${a.package}`}>
                    {a.instances.map((i) => (
                      <li key={i.appId}>
                        <span>{i.name || i.appId}</span>{" "}
                        {moving?.app === i.appId ? (
                          <span className="home-row">
                            <select
                              value={moving.to}
                              onChange={(e) => setMoving({ ...moving, to: e.target.value })}
                              data-testid={`move-target-${i.appId}`}
                              aria-label={`Organization to move ${i.name || i.appId} to`}
                            >
                              <option value="">Choose…</option>
                              {targets.map((o) => (
                                <option key={o.orgId} value={o.orgId}>
                                  {o.name || o.orgId}
                                </option>
                              ))}
                            </select>
                            <label className="home-check">
                              <input
                                type="checkbox"
                                checked={moving.bring}
                                onChange={(e) => setMoving({ ...moving, bring: e.target.checked })}
                                data-testid={`move-bring-${i.appId}`}
                              />
                              Bring the people who use it
                            </label>
                            <button
                              className="glass-btn glass-btn--primary"
                              disabled={!moving.to || busy !== null}
                              onClick={() => void moveOne(i.appId, i.name || i.appId, moving.to, moving.bring)}
                              data-testid={`move-go-${i.appId}`}
                            >
                              {busy === `move-${i.appId}` ? "Moving…" : "Move"}
                            </button>
                            <button className="glass-btn" disabled={busy !== null} onClick={() => setMoving(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            className="glass-btn"
                            disabled={busy !== null}
                            onClick={() => setMoving({ app: i.appId, to: "", bring: true })}
                            data-testid={`move-${i.appId}`}
                          >
                            Move to another organization…
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {a.team && (
                <button
                  className="glass-btn home-danger"
                  disabled={busy !== null || removing !== null}
                  onClick={() => void askRemove(a)}
                  data-testid={`remove-app-${a.package}`}
                >
                  Remove {a.name}…
                </button>
              )}
              {a.team?.join === "invite" && (
                <button
                  className="glass-btn"
                  disabled={busy !== null}
                  onClick={() => void openOne(a)}
                  data-testid={`open-${a.package}`}
                >
                  Open {a.name} to everyone
                </button>
              )}
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

      {removing?.stage === "reading" && (
        <p className="home-muted" role="status" data-testid="remove-app-reading">
          Reading what removing {removing.app.name} deletes…
        </p>
      )}
      {removing?.stage === "confirm" && (
        <div className="home-confirm glass-float" role="alertdialog" aria-labelledby="remove-app-title" data-testid="remove-app-confirm">
          <h3 id="remove-app-title">Remove {removing.app.name} from {orgName(view)}?</h3>
          {removing.instances.length === 0 ? (
            <p data-testid="remove-app-none">
              It has no instance yet: only its access list goes. Nobody&apos;s data is deleted.
            </p>
          ) : (
            <>
              <p>
                This <strong>deletes {removing.instances.length === 1 ? "this instance" : `these ${removing.instances.length} instances`} and
                all their data</strong>, for everyone. It cannot be undone.
              </p>
              <ul data-testid="remove-app-instances">
                {removing.instances.map((i) => (
                  <li key={i.appId} title={i.appId}>
                    {i.name}
                  </li>
                ))}
              </ul>
            </>
          )}
          <label className="home-field">
            <span>Type {removing.app.name} to confirm</span>
            <input
              value={removing.typed}
              onChange={(e) => setRemoving({ ...removing, typed: e.target.value })}
              data-testid="remove-app-typed"
            />
          </label>
          <div className="home-row">
            <button
              className="glass-btn glass-btn--primary home-danger"
              disabled={!typedMatches(removing.typed, removing.app.name) || busy !== null}
              onClick={() => void remove(removing.app)}
              data-testid="remove-app-yes"
            >
              {busy === `remove-${removing.app.package}` ? "Removing…" : `Remove ${removing.app.name}`}
            </button>
            <button className="glass-btn" disabled={busy !== null} onClick={() => setRemoving(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {removed && (
        <p className="home-notice" role="status" data-testid="app-removed">
          {removed} was removed from {orgName(view)}.
        </p>
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
          <p className="home-muted" data-testid="add-app-who">
            {apart
              ? "Only you have it at first: add its people from the People screen, or invite them."
              : "Everyone in the organization gets it."}
          </p>
          {apart && open.length > 0 && (
            <p className="home-notice" data-testid="add-app-closes">
              {open.map((a) => a.name).join(", ")} will list {open.length === 1 ? "its" : "their"} own people again.
              Everyone who has {open.length === 1 ? "it" : "them"} now keeps access.
            </p>
          )}
          <button type="submit" className="glass-btn glass-btn--primary" disabled={!pkg || busy !== null} data-testid="add-app">
            {busy?.startsWith("add-") ? "Adding…" : "Add app"}
          </button>
        </form>
      )}
      {added && (
        <p className="home-notice" role="status" data-testid="app-added">
          {packageTitle(added.package)} is set up{apart ? ". You lead it." : " for everyone in the organization. You lead it."}{" "}
          <a href={openLink(added.package, view.org, added.teamId)}>Open {packageTitle(added.package)}</a> to start using
          it here.
        </p>
      )}
      {movedTo && (
        <p className="home-notice" role="status" data-testid="app-moved">
          {movedTo.name} moved to {movedTo.org}, its data with it.
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
