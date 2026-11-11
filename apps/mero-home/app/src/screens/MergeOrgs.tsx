import { useEffect, useState } from "react";
import { passkeyConfirm, type CalimeroClient, type PasskeyProvider } from "@calimero-network/mero-js";
import { describeError, type ClientRoutes, type MyOrg } from "@calimero-apps/connect";

import { displayName, roleLabel, type OrgView } from "../home";
import {
  confirmsName,
  loadMergePlan,
  mayDeleteSource,
  mergeSources,
  moveEvery,
  type MergePlan,
  type MoveOutcome,
} from "../move";

export interface MergeOrgsProps {
  client: Pick<CalimeroClient, "appsReportAll"> & ClientRoutes<{ apps: "move"; orgs: "get" | "inviteList" | "delete" }>;
  /** The organization everything moves into. */
  view: OrgView;
  /** The caller's organizations. */
  orgs: readonly MyOrg[];
  account: string;
  passkey: () => PasskeyProvider;
  after: () => void;
  /** After a move or a deletion: the orgs and this one are read again. */
  onChanged: () => void;
}

type Plan = { kind: "none" } | { kind: "loading" } | { kind: "ready"; plan: MergePlan } | { kind: "failed"; error: string };

/**
 * "Merge organizations" (admins of both): pick an organization you
 * administer, see its apps, people and pending invites, move every app here
 * (one passkey prompt each) bringing the people who use them, see how each
 * went, and, as its owner, delete the source once it is empty, typing its
 * name to confirm.
 */
export function MergeOrgs({ client, view, orgs, account, passkey, after, onChanged }: MergeOrgsProps) {
  const sources = mergeSources(orgs, view.org);
  const [source, setSource] = useState("");
  const [plan, setPlan] = useState<Plan>({ kind: "none" });
  const [bring, setBring] = useState(true);
  const [moving, setMoving] = useState(false);
  const [outcomes, setOutcomes] = useState<MoveOutcome[]>([]);
  const [reads, setReads] = useState(0);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!source) {
      setPlan({ kind: "none" });
      return;
    }
    let live = true;
    setPlan({ kind: "loading" });
    loadMergePlan(client, source, account)
      .then((p) => live && setPlan({ kind: "ready", plan: p }))
      .catch((e) => live && setPlan({ kind: "failed", error: describeError(e) }))
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, source, account, reads, after]);

  const choose = (id: string) => {
    setSource(id);
    setOutcomes([]);
    setTyped("");
    setError(null);
    setDeleted(null);
  };

  async function moveAll(p: MergePlan) {
    setMoving(true);
    setError(null);
    setOutcomes([]);
    try {
      await moveEvery(client, p, view.org, bring, passkey, (o) => setOutcomes((prev) => [...prev, o]));
    } finally {
      setMoving(false);
      // The source as it is now: what is left in it decides whether it may go.
      setReads((n) => n + 1);
      onChanged();
      after();
    }
  }

  async function deleteSource(p: MergePlan) {
    setDeleting(true);
    setError(null);
    try {
      await client.orgs.delete({ org: p.source }, { confirm: passkeyConfirm(passkey()) });
      setDeleted(p.name);
      setSource("");
      onChanged();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setDeleting(false);
      after();
    }
  }

  const moved = outcomes.filter((o) => o.ok).length;

  return (
    <section className="home-card" aria-label="Merge organizations" data-testid="merge-orgs">
      <h2>Merge another organization into {view.name}</h2>
      <p className="home-muted">
        Every app of the organization you pick moves here with its data. Its people can come along: each joins{" "}
        {view.name} as a member (a guest stays a guest) with the apps they use.
      </p>
      {sources.length === 0 ? (
        <p className="home-muted" data-testid="merge-no-sources">
          You administer no other organization.
        </p>
      ) : (
        <label className="home-field">
          <span>Organization to merge</span>
          <select value={source} onChange={(e) => choose(e.target.value)} data-testid="merge-source" disabled={moving}>
            <option value="">Choose…</option>
            {sources.map((o) => (
              <option key={o.orgId} value={o.orgId}>
                {o.name || o.orgId}
              </option>
            ))}
          </select>
        </label>
      )}

      {plan.kind === "loading" && <p className="home-muted">Reading the organization…</p>}
      {plan.kind === "failed" && (
        <p className="home-error" role="alert">
          {plan.error}
        </p>
      )}
      {plan.kind === "ready" && (
        <>
          <h3>Apps ({plan.plan.apps.length})</h3>
          {plan.plan.apps.length === 0 ? (
            <p className="home-muted" data-testid="merge-empty">
              {plan.plan.name} holds no apps.
            </p>
          ) : (
            <ul className="home-list" data-testid="merge-apps">
              {plan.plan.apps.map((a) => (
                <li key={a.app}>{a.name}</li>
              ))}
            </ul>
          )}
          <h3>People ({plan.plan.people.length})</h3>
          <ul className="home-list" data-testid="merge-people">
            {plan.plan.people.map((p) => (
              <li key={p.account}>
                {displayName(p)} <span className="home-muted">· {roleLabel(p.role)}</span>
              </li>
            ))}
          </ul>
          <h3>Pending invitations ({plan.plan.invites.length})</h3>
          <p className="home-muted" data-testid="merge-invites">
            {plan.plan.invites.length === 0
              ? "None."
              : "Invitations into an app that moves are revoked once nothing is left on its team; the rest stay with " +
                `${plan.plan.name} until it is deleted.`}
          </p>

          {plan.plan.apps.length > 0 && (
            <>
              <label className="home-check">
                <input
                  type="checkbox"
                  checked={bring}
                  disabled={moving}
                  onChange={(e) => setBring(e.target.checked)}
                  data-testid="merge-bring"
                />
                Bring the people who use each app (they join {view.name}; admins come in as members)
              </label>
              <button
                className="glass-btn glass-btn--primary"
                disabled={moving}
                onClick={() => void moveAll(plan.plan)}
                data-testid="merge-move"
              >
                {moving
                  ? "Moving…"
                  : `Move ${plan.plan.apps.length === 1 ? "1 app" : `${plan.plan.apps.length} apps`} to ${view.name}`}
              </button>
              <p className="home-muted">Your passkey is asked once for each app.</p>
            </>
          )}

          {outcomes.length > 0 && (
            <>
              <h3>
                Moved {moved} of {outcomes.length}
              </h3>
              <ul className="home-list" data-testid="merge-results">
                {outcomes.map((o) => (
                  <li key={o.app} data-testid={`merge-result-${o.app}`}>
                    <strong>{o.name}</strong>{" "}
                    {o.ok ? (
                      <span>
                        moved{o.result.added.length > 0 ? `, ${o.result.added.length} joined ${view.name}` : ""}
                      </span>
                    ) : (
                      <span className="home-error">not moved: {o.error}</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {(outcomes.length > 0 || plan.plan.apps.length === 0) &&
            (mayDeleteSource(plan.plan) ? (
              <form
                className="home-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (confirmsName(typed, plan.plan.name)) void deleteSource(plan.plan);
                }}
              >
                <p className="home-notice">
                  {plan.plan.name} is empty now. Deleting it removes its people and its remaining invitations. Type{" "}
                  <strong>{plan.plan.name}</strong> to confirm.
                </p>
                <label className="home-field">
                  <span>Organization name</span>
                  <input value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="merge-delete-name" />
                </label>
                <button
                  type="submit"
                  className="glass-btn"
                  disabled={deleting || !confirmsName(typed, plan.plan.name)}
                  data-testid="merge-delete"
                >
                  {deleting ? "Deleting…" : `Delete ${plan.plan.name}`}
                </button>
              </form>
            ) : (
              <p className="home-muted" data-testid="merge-keep">
                {plan.plan.role !== "owner"
                  ? `Only ${plan.plan.name}'s owner can delete it.`
                  : `${plan.plan.name} still holds ${plan.plan.apps.length === 1 ? "1 app" : `${plan.plan.apps.length} apps`}; it can be deleted once it is empty.`}
              </p>
            ))}
        </>
      )}
      {deleted && (
        <p className="home-notice" role="status" data-testid="merge-deleted">
          {deleted} is deleted.
        </p>
      )}
      {error && (
        <p className="home-error" role="alert" data-testid="merge-error">
          {error}
        </p>
      )}
    </section>
  );
}
