import { useCallback, useEffect, useState } from "react";
import { passkeyConfirm, type CalimeroClient, type OrgInvite, type PasskeyProvider } from "@calimero-network/mero-js";
import { InviteDialog } from "@calimero-network/mero-react";
import { describeError, inviteLinkBase } from "@calimero-apps/connect";

import { inviteRoot } from "../invites";
import { DEFAULT_EXPIRY, EXPIRY_OPTIONS, inviteApps, inviteExpiry, inviteTerms, invitableApps, isAdmin, roleLabel, type OrgView } from "../homeOrg";

type Pending = { kind: "loading" } | { kind: "ready"; invites: Array<OrgInvite & { allApps?: boolean }> } | { kind: "failed"; error: string };

export interface InvitationsProps {
  client: CalimeroClient;
  view: OrgView;
  account: string;
  passkey: () => PasskeyProvider;
  after: () => void;
  /** Where a minted link opens (default: this page's own path). */
  root?: () => string;
}

/**
 * Invite people to one app or several (an invite naming those app teams:
 * the person gets those apps and no other; an admin choosing every app also
 * covers the ones added later), and the pending invites the caller may see,
 * each with Revoke. Admins invite to any app and as any role
 * up to admin; leads and members allowed by an app's switch invite to those
 * apps (decision 1, `invitableApps`).
 */
export function Invitations({ client, view, account, passkey, after, root = inviteRoot }: InvitationsProps) {
  const apps = invitableApps(view);
  const admin = isAdmin(view.role);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(apps.length === 1 ? [apps[0]!.package] : []));
  const [role, setRole] = useState<"member" | "guest" | "admin">("member");
  const [later, setLater] = useState(false);
  const [uses, setUses] = useState(1);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>({ kind: "loading" });
  const [revoking, setRevoking] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      // The document lets an invite carry the `owner` role and `allApps`; mero-js's `OrgInvite` does not.
      const list = (await client.orgs.inviteList({ org: view.org })).invites as Array<OrgInvite & { allApps?: boolean }>;
      setPending({ kind: "ready", invites: [...list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)) });
    } catch (e) {
      setPending({ kind: "failed", error: describeError(e) });
    } finally {
      after();
    }
  }, [client, view.org, after]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const allChosen = apps.length > 0 && apps.every((a) => chosen.has(a.package));
  // Core refuses "every app, and those added later" to anyone below admin.
  const terms = inviteTerms(apps, chosen, admin && later);

  const toggle = (pkg: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(pkg)) next.delete(pkg);
      else next.add(pkg);
      return next;
    });

  async function revoke(key: string) {
    setRevoking(key);
    setError(null);
    try {
      await client.orgs.inviteRevoke({ org: view.org, key }, { confirm: passkeyConfirm(passkey()) });
      await refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setRevoking(null);
      after();
    }
  }

  return (
    <section className="home-card" aria-label="Invitations">
      <h2>Invite people</h2>
      {apps.length === 0 ? (
        <p className="home-muted" data-testid="no-invitable-apps">
          {admin
            ? "This organization has no app set up yet. Set one up on the Admin screen, then invite people to it."
            : "You may not invite to any app here."}
        </p>
      ) : (
        <form
          className="home-form"
          onSubmit={(e) => {
            e.preventDefault();
            setInviting(true);
          }}
        >
          <fieldset>
            <legend>Apps they get</legend>
            {apps.length > 1 && (
              <label className="home-check">
                <input
                  type="checkbox"
                  checked={allChosen}
                  ref={(el) => {
                    if (el) el.indeterminate = chosen.size > 0 && !allChosen;
                  }}
                  onChange={() => setChosen(allChosen ? new Set() : new Set(apps.map((a) => a.package)))}
                  data-testid="invite-all-apps"
                />
                <strong>All apps</strong>
              </label>
            )}
            {apps.map((a) => (
              <label key={a.package} className="home-check">
                <input
                  type="checkbox"
                  checked={chosen.has(a.package)}
                  onChange={() => toggle(a.package)}
                  data-testid={`invite-app-${a.package}`}
                />
                {a.name}
              </label>
            ))}
            {allChosen && view.mode === "shared" &&
              (admin ? (
                <label className="home-check" data-testid="invite-all-later">
                  <input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} data-testid="invite-later" />
                  Also the apps added to the organization later
                </label>
              ) : (
                <p className="home-muted" data-testid="invite-all-later">
                  Apps added to the organization later are not part of this invitation.
                </p>
              ))}
          </fieldset>
          <div className="home-row">
            <label className="home-field">
              <span>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} data-testid="invite-role">
                <option value="member">Member</option>
                <option value="guest">Guest (these apps only, no directory)</option>
                {admin && <option value="admin">Admin (every app)</option>}
              </select>
            </label>
            <label className="home-field">
              <span>Uses</span>
              <input
                type="number"
                min={1}
                max={100}
                value={uses}
                onChange={(e) => setUses(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                data-testid="invite-uses"
              />
            </label>
          </div>
          <button
            type="submit"
            className="glass-btn glass-btn--primary"
            disabled={chosen.size === 0}
            data-testid="invite-create"
          >
            Create invitation link
          </button>
        </form>
      )}
      {error && (
        <p className="home-error" role="alert" data-testid="invite-error">
          {error}
        </p>
      )}

      <InviteDialog
        open={inviting}
        onClose={() => setInviting(false)}
        client={client}
        passkey={passkey()}
        org={view.org}
        role={role}
        teams={terms.teams}
        allApps={terms.allApps}
        uses={uses}
        ttlSecs={DEFAULT_EXPIRY}
        expiryOptions={EXPIRY_OPTIONS}
        linkBase={inviteLinkBase({ org: view.org, root: root() })}
        labels={{
          noun: "organization",
          note: "The link opens Calimero Home, which joins them and shows their apps.",
          title: "Invite people",
        }}
        onInvited={() => void refresh()}
      />

      <h2>Pending invitations</h2>
      {pending.kind === "loading" && <p className="home-muted">Loading…</p>}
      {pending.kind === "failed" && (
        <p className="home-error" role="alert">
          {pending.error}
        </p>
      )}
      {pending.kind === "ready" && pending.invites.length === 0 && (
        <p className="home-muted" data-testid="no-pending">
          No pending invitations you can see.
        </p>
      )}
      {pending.kind === "ready" && pending.invites.length > 0 && (
        <ul className="home-list" data-testid="pending-invites">
          {pending.invites.map((inv) => (
            <li key={inv.inviteKey} className="home-app" data-testid={`pending-${inv.inviteKey}`}>
              <div>
                <strong>{inviteApps(inv, view)}</strong>
                <span className="home-muted">
                  {" "}
                  · {roleLabel(inv.role)} · {inv.usesLeft} use{inv.usesLeft === 1 ? "" : "s"} left · {inviteExpiry(inv)}
                  {inv.createdBy === account ? " · yours" : ""}
                </span>
              </div>
              <button
                className="glass-btn"
                disabled={revoking !== null}
                onClick={() => void revoke(inv.inviteKey)}
                data-testid={`revoke-${inv.inviteKey}`}
              >
                {revoking === inv.inviteKey ? "Revoking…" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
