import { useEffect, useState } from "react";
import { appInviteTeams, appOnlyInviteNote, describeError } from "@calimero-apps/connect";
import { ManageInHomeLink } from "@calimero-apps/passkey";
import { InviteDialog } from "@calimero-network/mero-react";

import { inviteLinkBase } from "./lib/orgs";
import { canManage, deleteWorkspace, leaveWorkspace, removeMember, roleName, setOrgRole, type ManagedRole } from "./lib/manage";
import { forgetWorkspaceRecordings } from "./useRecording";
import { PersonName, useOrg, useSpaceNames } from "./names";
import { PRODUCT } from "./session";
import { useSessionApi, useSignedIn } from "./sessionContext";
import { Avatar, Icon } from "./ui";

const ROLE_HELP: { role: string; what: string }[] = [
  { role: "Owner", what: "Everything an admin can do. Made the workspace; can't be removed." },
  { role: "Admin", what: "Invites people, changes roles, removes people and deletes any meeting." },
  { role: "Member", what: "Records and uploads meetings, reads every transcript, ticks off action items." },
];

/**
 * Who is in the workspace, and for its owners and admins: invite people,
 * change a role, remove someone. Everyone can leave.
 */
export function PeoplePage({ appId, workspaceName, onLeft }: { appId: string; workspaceName: string; onLeft: () => void }) {
  const { client, accountId, source, passkey, after } = useSignedIn();
  const { api } = useSessionApi();
  const { org, members, reload } = useOrg();
  const { nameOf } = useSpaceNames();
  const [inviting, setInviting] = useState(false);
  const [invite, setInvite] = useState<{ teams: string[]; appOnly: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!org) return;
    let live = true;
    appInviteTeams(client, org, source)
      .then((t) => live && setInvite(t))
      .catch(() => live && setInvite({ teams: [], appOnly: false }))
      .finally(after);
    return () => {
      live = false;
    };
  }, [client, org, source, after]);

  const myRole = members?.roles.get(accountId);
  const manager = canManage(myRole);
  // In an organization that keeps its apps apart, its roles are Calimero Home's.
  const rolesHere = manager && members !== null && !members.appOnly;
  const people = members ? [...members.people].sort((a, b) => order(members.roles.get(a)) - order(members.roles.get(b))) : null;

  async function act(account: string, fn: () => Promise<unknown>) {
    setBusy(account);
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
      setConfirming(null);
      after();
    }
  }

  if (!org) {
    return (
      <section className="card">
        <p className="empty">This workspace has no organization, so it has no member list.</p>
      </section>
    );
  }

  return (
    <div className="people-page">
      <header className="page-head">
        <div>
          <h1>People</h1>
          <p className="dim">
            Everyone here can read the meetings in {workspaceName || "this workspace"}.
          </p>
        </div>
        {manager ? (
          <button type="button" className="btn primary" onClick={() => setInviting(true)} data-testid="invite-people">
            <Icon name="plus" /> Invite people
          </button>
        ) : (
          <span className="dim">Ask an owner or admin to invite people.</span>
        )}
      </header>

      <section className="card flush">
        <div className="card-head padded">
          <h2>Members</h2>
          {people && <span className="count">{people.length}</span>}
        </div>
        {people === null && <p className="empty padded">Loading people…</p>}
        {people && (
          <ul className="member-list">
            {people.map((account) => {
              const role = members?.roles.get(account);
              const self = account === accountId;
              const changeable = rolesHere && !self && (role === "admin" || role === "member");
              const removable = manager && !self && role !== "owner";
              return (
                <li key={account} className="member-row" data-testid="member-row">
                  <Avatar account={account} size={36} />
                  <div className="member-who">
                    <span className="member-name">
                      <PersonName account={account} />
                      {self && <span className="you-tag">You</span>}
                    </span>
                    <span className="mono dim member-id" title={account}>
                      {nameOf(account) ? `${account.slice(0, 8)}…${account.slice(-6)}` : "No name set yet"}
                    </span>
                  </div>
                  <div className="member-actions">
                    {confirming === account ? (
                      <>
                        <span className="dim">Remove from {PRODUCT}?</span>
                        <button
                          type="button"
                          className="btn small danger"
                          disabled={busy === account}
                          onClick={() => void act(account, () => removeMember(client, org, source, account, passkey))}
                        >
                          {busy === account ? "Removing…" : "Remove"}
                        </button>
                        <button type="button" className="btn small ghost" onClick={() => setConfirming(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        {changeable ? (
                          <select
                            aria-label={`Role for ${nameOf(account) ?? "this member"}`}
                            value={role}
                            disabled={busy === account}
                            onChange={(e) =>
                              void act(account, () => setOrgRole(client, org, account, e.target.value as ManagedRole, passkey))
                            }
                          >
                            <option value="admin">Admin</option>
                            <option value="member">Member</option>
                          </select>
                        ) : (
                          <span className={`role-badge ${role === "owner" || role === "admin" ? "strong" : ""}`}>{roleName(role)}</span>
                        )}
                        {removable && (
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Remove ${nameOf(account) ?? "this member"}`}
                            title="Remove from this workspace"
                            onClick={() => setConfirming(account)}
                          >
                            <Icon name="trash" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {error && <pre className="err padded">{error}</pre>}
        {manager && members?.appOnly && (
          <p className="dim padded">
            This organization keeps its apps apart, so its roles are managed in Calimero Home.{" "}
            <ManageInHomeLink session={api.session} org={org} className="inline-link" />
          </p>
        )}
      </section>

      <section className="card">
        <h2>Roles</h2>
        <dl className="role-help">
          {ROLE_HELP.map((r) => (
            <div key={r.role}>
              <dt>{r.role}</dt>
              <dd>{r.what}</dd>
            </div>
          ))}
        </dl>
      </section>

      {myRole !== "owner" && (
        <section className="card danger-zone">
          <div>
            <h2>Leave this workspace</h2>
            <p className="dim">You lose access to its meetings until someone invites you again.</p>
          </div>
          {leaving ? (
            <div className="row">
              <button
                type="button"
                className="btn danger"
                disabled={busy === accountId}
                onClick={() =>
                  void act(accountId, async () => {
                    await leaveWorkspace(client, org, source, passkey);
                    onLeft();
                  })
                }
              >
                {busy === accountId ? "Leaving…" : "Leave"}
              </button>
              <button type="button" className="btn ghost" onClick={() => setLeaving(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="btn danger-ghost" onClick={() => setLeaving(true)}>
              Leave workspace
            </button>
          )}
        </section>
      )}

      {manager && (
        <section className="card danger-zone">
          <div>
            <h2>Delete this workspace</h2>
            <p className="dim">
              Its meetings, recordings and action items are deleted for everyone. This can&apos;t be undone.
            </p>
          </div>
          {deletingAll ? (
            <div className="row">
              <button
                type="button"
                className="btn danger"
                disabled={busy === appId}
                onClick={() =>
                  void act(appId, async () => {
                    await deleteWorkspace(client, appId);
                    void forgetWorkspaceRecordings(appId);
                    onLeft();
                  })
                }
              >
                {busy === appId ? "Deleting…" : `Delete ${workspaceName || "workspace"}`}
              </button>
              <button type="button" className="btn ghost" onClick={() => setDeletingAll(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="btn danger-ghost" onClick={() => setDeletingAll(true)} data-testid="delete-workspace">
              Delete workspace
            </button>
          )}
        </section>
      )}

      {manager && (
        <InviteDialog
          client={client}
          passkey={passkey()}
          open={inviting}
          onClose={() => {
            setInviting(false);
            reload();
          }}
          org={org}
          teams={invite?.teams}
          appName={PRODUCT}
          inviterName={nameOf(accountId) ?? undefined}
          labels={{
            noun: "workspace",
            title: `Invite to ${workspaceName || "this workspace"}`,
            subtitle: "Choose what the people you invite can do, then share the link.",
            note: invite?.appOnly ? appOnlyInviteNote(PRODUCT) : undefined,
          }}
          linkBase={inviteLinkBase(appId, org)}
        />
      )}
    </div>
  );
}

function order(role: string | undefined): number {
  return role === "owner" ? 0 : role === "admin" ? 1 : role === "member" ? 2 : 3;
}
