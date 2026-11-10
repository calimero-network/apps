import { useEffect, useState } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { describeError } from "@calimero-apps/connect";

import {
  accessCell,
  appsOf,
  displayName,
  giveAllPlan,
  isAdmin,
  loadRosters,
  managesAnyApp,
  mayChangeSeat,
  removeAllPlan,
  roleLabel,
  runEach,
  seatsFor,
  setSeat,
  type BulkPlan,
  type BulkResult,
  type Cell,
  type OrgApp,
  type OrgView,
  type Person,
  type Rosters,
  type Seat,
} from "../home";

const CELL_TEXT: Record<Cell, string> = {
  all: "Yes (everyone)",
  lead: "Lead",
  member: "Yes",
  readOnly: "Read only",
  none: "No",
  removed: "Removed",
  unknown: "Not shown",
};

const SEAT_TEXT: Record<Seat, string> = {
  none: "No",
  member: "Member",
  readOnly: "Read only",
  lead: "Lead",
};

export interface PeopleProps {
  client: Pick<CalimeroClient, "getTeam" | "removeMember" | "setTeamMember" | "removeTeamMember">;
  view: OrgView;
  account: string;
  passkey: () => PasskeyProvider;
  after: () => void;
  /** After a removal: the org is read again. */
  onChanged: () => void;
}

type Bulk = "give" | "remove";

/** A bulk action waiting for its confirm, running, or done. */
type BulkState =
  | { stage: "confirm"; kind: Bulk; person: Person; plan: BulkPlan }
  | { stage: "running"; kind: Bulk; person: Person; plan: BulkPlan; done: number; current: OrgApp | null }
  | { stage: "done"; kind: Bulk; person: Person; plan: BulkPlan; result: BulkResult };

const names = (apps: readonly OrgApp[]) => apps.map((a) => a.name).join(", ");

const prompts = (n: number) => (n === 1 ? "once" : `${n} times, once per app`);

/**
 * The organization's people and, per app, who is in it. Core decides who
 * appears (decision 2): an admin sees everyone; in a shared org a member sees
 * the people sharing an app with them, and the org's admins. Guests get no
 * People screen at all (decision 3, `screensFor`).
 *
 * Whoever manages a closed app team (an owner or admin, or its lead) sets each
 * person's place in it from the matrix: No, Member, Read only or Lead. No takes
 * them out of that app only (and, core#4891, out of every team below it). An
 * admin can also remove someone from the organization, which takes them out of
 * every app in it (decision 6): a separate, confirmed action.
 *
 * "Give all apps" adds a person, as a Member, to every closed app the caller
 * manages, and "Remove from all apps" takes them out of each (never out of the
 * organization). Core has no batch route for team rows, so each app is its
 * own passkey step-up, run one after the other with "2 of 5" progress; the
 * run stops at the first refusal or cancelled prompt and says what was done.
 */
export function People({ client, view, account, passkey, after, onChanged }: PeopleProps) {
  const [rosters, setRosters] = useState<Rosters>(new Map());
  const [removing, setRemoving] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The cell being changed (`team:account`), while its passkey step-up runs. */
  const [changing, setChanging] = useState<string | null>(null);
  const [cellError, setCellError] = useState<string | null>(null);
  const [rostersRead, setRostersRead] = useState(0);
  const [bulk, setBulk] = useState<BulkState | null>(null);
  /**
   * Whether the rows as they are now are read: a bulk plan made from rows
   * being read again (after a change) could demote someone just made a lead.
   */
  const [rostersReady, setRostersReady] = useState(false);
  const admin = isAdmin(view.role);
  const manager = managesAnyApp(view);
  const bulkRunning = bulk?.stage === "running";

  useEffect(() => {
    let live = true;
    setRostersReady(false);
    loadRosters(client, view.org, view.apps)
      .then((r) => {
        if (!live) return;
        setRosters(r);
        setRostersReady(true);
      })
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, view, after, rostersRead]);

  async function changeSeat(app: OrgApp, p: Person, seat: Seat) {
    if (!app.team) return;
    const key = `${app.team.teamId}:${p.account}`;
    setChanging(key);
    setCellError(null);
    setNotice(null);
    try {
      await setSeat(client, view.org, app.team.teamId, p.account, seat, passkey());
      setNotice(
        seat === "none"
          ? `${displayName(p)} was taken out of ${app.name}.`
          : `${displayName(p)} is in ${app.name}: ${SEAT_TEXT[seat]}.`,
      );
      // The rows now, and the org (member counts) as it is now.
      setRostersRead((n) => n + 1);
      onChanged();
    } catch (e) {
      setCellError(describeError(e));
    } finally {
      setChanging(null);
      after();
    }
  }

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

  function askBulk(kind: Bulk, p: Person) {
    setNotice(null);
    setCellError(null);
    setRemoving(null);
    const plan = kind === "give" ? giveAllPlan(view, rosters, p) : removeAllPlan(view, rosters, p);
    setBulk({ stage: "confirm", kind, person: p, plan });
  }

  async function runBulk(kind: Bulk, p: Person, plan: BulkPlan) {
    setBulk({ stage: "running", kind, person: p, plan, done: 0, current: plan.apps[0] ?? null });
    const result = await runEach(
      plan.apps,
      (app) => setSeat(client, view.org, app.team!.teamId, p.account, kind === "give" ? "member" : "none", passkey()),
      (done, current) => setBulk({ stage: "running", kind, person: p, plan, done, current }),
    );
    setBulk({ stage: "done", kind, person: p, plan, result });
    if (result.done.length > 0) {
      setRostersRead((n) => n + 1);
      onChanged();
    }
    after();
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
      {cellError && (
        <p className="home-error" role="alert" data-testid="seat-error">
          {cellError}
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
              {(admin || manager) && <th scope="col" aria-label="Actions" />}
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
                  if (a.team && mayChangeSeat(view, a, rosters, p, account)) {
                    const seat: Seat = cell === "lead" || cell === "member" || cell === "readOnly" ? cell : "none";
                    const key = `${a.team.teamId}:${p.account}`;
                    return (
                      <td key={a.package} className={`home-cell home-cell--${cell}`}>
                        <select
                          aria-label={`${displayName(p)} in ${a.name}`}
                          value={seat}
                          disabled={changing !== null}
                          data-testid={`seat-${a.package}-${p.account}`}
                          onChange={(e) => void changeSeat(a, p, e.target.value as Seat)}
                        >
                          {seatsFor(p).map((s) => (
                            <option key={s} value={s}>
                              {SEAT_TEXT[s]}
                            </option>
                          ))}
                        </select>
                        {changing === key ? " Saving…" : ""}
                      </td>
                    );
                  }
                  return (
                    <td key={a.package} className={`home-cell home-cell--${cell}`}>
                      {CELL_TEXT[cell]}
                    </td>
                  );
                })}
                {(admin || manager) && (
                  <td className="home-actions">
                    {manager && p.account !== account && (
                      <>
                        <button
                          className="glass-btn"
                          disabled={!rostersReady || bulkRunning || changing !== null}
                          data-testid={`give-all-${p.account}`}
                          onClick={() => askBulk("give", p)}
                        >
                          Give all apps…
                        </button>
                        <button
                          className="glass-btn"
                          disabled={!rostersReady || bulkRunning || changing !== null}
                          data-testid={`remove-all-${p.account}`}
                          onClick={() => askBulk("remove", p)}
                        >
                          Remove from all apps…
                        </button>
                      </>
                    )}
                    {mayRemove(p) && (
                      <button
                        className="glass-btn home-danger"
                        data-testid={`remove-${p.account}`}
                        disabled={bulkRunning}
                        onClick={() => {
                          setError(null);
                          setBulk(null);
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

      {bulk && <BulkPanel bulk={bulk} onRun={runBulk} onClose={() => setBulk(null)} />}

      {removing && (
        <div className="home-confirm glass-float" role="alertdialog" aria-labelledby="remove-title" data-testid="remove-confirm">
          <h3 id="remove-title">Remove {displayName(removing)} from {view.name}?</h3>
          <p>
            This removes them from the organization <strong>and from every app in it</strong>
            {leaving.length > 0 ? `: ${leaving.map((a) => a.name).join(", ")}` : ""}. To take someone
            out of one app only, set them to No in that app&apos;s column instead.
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

const VERB: Record<Bulk, { doing: string; done: string; title: (who: string) => string; go: string }> = {
  give: {
    doing: "added",
    done: "Added to",
    title: (who) => `Give ${who} all apps?`,
    go: "Give all apps",
  },
  remove: {
    doing: "removed",
    done: "Taken out of",
    title: (who) => `Remove ${who} from all apps?`,
    go: "Remove from all apps",
  },
};

function SkippedList({ skipped }: { skipped: BulkPlan["skipped"] }) {
  if (skipped.length === 0) return null;
  return (
    <>
      <p>Left as they are:</p>
      <ul data-testid="bulk-skipped">
        {skipped.map((s) => (
          <li key={s.app.package} data-testid={`bulk-skipped-${s.app.package}`}>
            {s.app.name}: {s.why}
          </li>
        ))}
      </ul>
    </>
  );
}

/** The confirm, the progress and the report of "Give all apps" / "Remove from all apps". */
function BulkPanel({
  bulk,
  onRun,
  onClose,
}: {
  bulk: BulkState;
  onRun: (kind: Bulk, p: Person, plan: BulkPlan) => Promise<void>;
  onClose: () => void;
}) {
  const { kind, person, plan } = bulk;
  const who = displayName(person);
  const verb = VERB[kind];
  return (
    <div className="home-confirm glass-float" role="alertdialog" aria-labelledby="bulk-title" data-testid="bulk-panel">
      <h3 id="bulk-title">{verb.title(who)}</h3>
      {bulk.stage === "confirm" && (
        <>
          {plan.apps.length === 0 ? (
            <p data-testid="bulk-nothing">
              {kind === "give"
                ? `There is no app you manage that ${who} is not in already.`
                : `${who} is in no app you can take them out of.`}
            </p>
          ) : (
            <p data-testid="bulk-plan">
              {kind === "give" ? `${who} joins, as a Member: ` : `${who} leaves: `}
              <strong>{names(plan.apps)}</strong>.{" "}
              {kind === "remove" && "They stay in the organization. "}
              Your passkey is asked {prompts(plan.apps.length)}.
            </p>
          )}
          <SkippedList skipped={plan.skipped} />
          <div className="home-row">
            {plan.apps.length > 0 && (
              <button
                className={`glass-btn glass-btn--primary${kind === "remove" ? " home-danger" : ""}`}
                data-testid="bulk-confirm-yes"
                onClick={() => void onRun(kind, person, plan)}
              >
                {verb.go}
              </button>
            )}
            <button className="glass-btn" onClick={onClose}>
              {plan.apps.length > 0 ? "Cancel" : "Close"}
            </button>
          </div>
        </>
      )}
      {bulk.stage === "running" && (
        <p role="status" data-testid="bulk-progress">
          {bulk.done} of {plan.apps.length} {verb.doing}
          {bulk.current ? `: confirm ${bulk.current.name} with your passkey…` : "…"}
        </p>
      )}
      {bulk.stage === "done" && (
        <div role="status" data-testid="bulk-report">
          {bulk.result.done.length > 0 && (
            <p className="home-notice" data-testid="bulk-done">
              {verb.done} {names(bulk.result.done)}.
            </p>
          )}
          {bulk.result.failed && (
            <p className="home-error" data-testid="bulk-failed">
              {bulk.result.failed.app.name} was not {verb.doing}: {describeError(bulk.result.failed.error)}
              {bulk.result.notTried.length > 0 ? ` Not tried: ${names(bulk.result.notTried)}.` : ""}
            </p>
          )}
          <SkippedList skipped={plan.skipped} />
          <button className="glass-btn" onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
