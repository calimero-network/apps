import { useCallback, useEffect, useState } from "react";
import type { CalimeroClient, OrgInvite, PasskeyProvider } from "@calimero-network/mero-js";
import { describeError, inviteLink, inviteToApp } from "@calimero-apps/connect";

import { inviteRoot } from "../invites";
import { TTL_CHOICES, inviteApps, inviteExpiry, invitableApps, isAdmin, roleLabel, type OrgView } from "../home";

type Pending = { kind: "loading" } | { kind: "ready"; invites: OrgInvite[] } | { kind: "failed"; error: string };

export interface InvitationsProps {
  client: Pick<CalimeroClient, "listAppTeams" | "invite" | "listInvites" | "revokeInvite">;
  view: OrgView;
  account: string;
  passkey: () => PasskeyProvider;
  after: () => void;
  /** Where a minted link opens (default: this page's own path). */
  root?: () => string;
}

/**
 * Invite people to one app or several (an invite naming those app teams:
 * the person gets those apps and no other), and the pending invites the
 * caller may see, each with Revoke. Admins invite to any app and as any role
 * up to admin; leads and members allowed by an app's switch invite to those
 * apps (decision 1, `invitableApps`).
 */
export function Invitations({ client, view, account, passkey, after, root = inviteRoot }: InvitationsProps) {
  const apps = invitableApps(view);
  const admin = isAdmin(view.role);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(apps.length === 1 ? [apps[0]!.package] : []));
  const [role, setRole] = useState<"member" | "guest" | "admin">("member");
  const [uses, setUses] = useState(1);
  const [ttl, setTtl] = useState(TTL_CHOICES[1]!.secs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>({ kind: "loading" });
  const [revoking, setRevoking] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await client.listInvites(view.org);
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

  // Every app the caller may name now. Core has no standing invite to "every
  // app, and those added later" (an invite names its teams when it is made),
  // so apps added after it are not in it.
  const allChosen = apps.length > 0 && apps.every((a) => chosen.has(a.package));

  const toggle = (pkg: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(pkg)) next.delete(pkg);
      else next.add(pkg);
      return next;
    });

  async function create() {
    setBusy(true);
    setError(null);
    setLink(null);
    try {
      const made = await inviteToApp(client, view.org, [...chosen], {
        role,
        passkey: passkey(),
        uses,
        ttlSecs: ttl,
      });
      setLink(inviteLink(made.token, { org: view.org, root: root() }));
      await refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
      after();
    }
  }

  async function revoke(key: string) {
    setRevoking(key);
    setError(null);
    try {
      await client.revokeInvite(view.org, key, passkey());
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
            void create();
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
            {allChosen && view.mode === "shared" && (
              <p className="home-muted" data-testid="invite-all-later">
                Apps added to the organization later are not part of this invitation.
              </p>
            )}
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
            <label className="home-field">
              <span>Valid for</span>
              <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
                {TTL_CHOICES.map((c) => (
                  <option key={c.secs} value={c.secs}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="submit"
            className="glass-btn glass-btn--primary"
            disabled={busy || chosen.size === 0}
            data-testid="invite-create"
          >
            {busy ? "Creating…" : "Create invitation link"}
          </button>
        </form>
      )}
      {link && (
        <div className="home-link" data-testid="invite-link">
          <p className="home-muted">Send this link. It opens Calimero Home, which joins them and shows their apps.</p>
          <pre aria-label="invitation link">{link}</pre>
        </div>
      )}
      {error && (
        <p className="home-error" role="alert" data-testid="invite-error">
          {error}
        </p>
      )}

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
