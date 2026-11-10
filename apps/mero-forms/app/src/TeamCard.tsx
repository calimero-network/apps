import { useState } from "react";
import { appOnlyInviteNote, describeError } from "@calimero-apps/connect";
import { PRODUCT_NAME, inviteLink, inviteToken } from "./lib/orgs";
import { PersonName, useOrg } from "./names";
import { useSignedIn } from "./sessionContext";
import { Avatar } from "./ui";
import { useRead, type Workspace } from "./useWorkspace";

/**
 * Who builds the forms and reads the responses, and how to bring someone in.
 *
 * Joining the organization is not joining the team: an org member reaches the
 * workspace, but only the team (the admins and the accounts they add) builds
 * forms and reads responses. So an admin brings someone in in two steps: the
 * invitation link, then "Add to team" once they appear below as a member.
 */
export function TeamCard({
  workspace,
  appId,
  org,
  isAdmin,
  me,
}: {
  workspace: Workspace;
  appId: string;
  org: string | null;
  isAdmin: boolean;
  me: string | null;
}) {
  const { members, reload } = useOrg();
  const team = useRead(workspace.client, workspace.version, (c) => c.listTeam(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onTeam = new Set((team.data ?? []).map((m) => m.account));
  // Who has Mero Forms in the org (its app team, else the org): only they reach the workspace.
  const candidates = members ? members.people.filter((a) => !onTeam.has(a)).sort() : null;

  function run(account: string, fn: () => Promise<unknown>) {
    setBusy(account);
    setError(null);
    fn()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  }

  return (
    <>
      <section className="card">
        <h2>Team</h2>
        <p className="empty">The team builds the forms, reads every response and sends them on.</p>
        {team.error && <pre className="err">{team.error}</pre>}
        <ul className="people-list">
          {(team.data ?? []).map((m) => (
            <li key={m.account} className="person-row">
              <Avatar account={m.account} size={28} />
              <span className="person-name">
                <PersonName account={m.account} />
                {m.account === me && <span className="dim"> (you)</span>}
              </span>
              <span className="badge">{m.admin ? "Admin" : "Team"}</span>
              {isAdmin && !m.admin && (
                <button
                  className="ghost danger-text"
                  disabled={busy === m.account}
                  onClick={() => run(m.account, () => workspace.act((c) => c.removeTeamMember({ who: m.account })))}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && (
        <section className="card">
          <h2>Members not on the team</h2>
          <p className="empty">
            People in this workspace&apos;s organization. Add them to give them the forms.
          </p>
          {candidates === null && <p className="empty">Loading members…</p>}
          {candidates !== null && candidates.length === 0 && (
            <p className="empty">Nobody waiting. Send an invitation below.</p>
          )}
          <ul className="people-list">
            {(candidates ?? []).map((account) => (
              <li key={account} className="person-row">
                <Avatar account={account} size={28} />
                <span className="person-name">
                  <PersonName account={account} />
                </span>
                <button
                  disabled={busy === account}
                  onClick={() =>
                    run(account, async () => {
                      await workspace.act((c) => c.addTeamMember({ who: account }));
                      reload();
                    })
                  }
                >
                  {busy === account ? "Adding…" : "Add to team"}
                </button>
              </li>
            ))}
          </ul>
          {error && <pre className="err">{error}</pre>}
        </section>
      )}

      {isAdmin && org && <InviteCard org={org} appId={appId} />}
    </>
  );
}

/**
 * Make a shareable invitation into this workspace's organization: an org
 * invite token, approved with your passkey, in a link that opens this app and
 * lands in this workspace. Whoever opens it joins the org; add them to the
 * team above to give them the forms.
 */
export function InviteCard({ org, appId }: { org: string; appId: string }) {
  const { client, passkey, after, source } = useSignedIn();
  const [link, setLink] = useState<string | null>(null);
  const [appOnly, setAppOnly] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function mint() {
    setBusy(true);
    setFailed(null);
    setCopied(false);
    try {
      const made = await inviteToken(client, org, passkey(), source);
      setLink(inviteLink(made.token, appId, window.location, org));
      setAppOnly(made.appOnly);
    } catch (e) {
      setFailed(describeError(e));
    } finally {
      setBusy(false);
      after();
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // The link is on screen and selectable; the clipboard is a convenience.
      setCopied(false);
    }
  }

  return (
    <div className="card">
      <h2>Invite a teammate</h2>
      <p className="empty" style={{ marginBottom: 14 }}>
        One link, approved with your passkey. Whoever opens it signs in with a passkey and joins
        this workspace&apos;s organization; add them to the team above to give them the forms.
        Single use: one person can join with this link. Generate another for each person you invite.
      </p>
      <div className="row">
        <button onClick={() => void mint()} disabled={busy}>
          {busy ? "Creating…" : link ? "Create another" : "Create invite link"}
        </button>
        {link && (
          <button className="ghost" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      {link && (
        <code className="invite-link mono" title={link}>
          {link}
        </code>
      )}
      {link && appOnly && (
        <p className="empty" data-testid="invite-app-only">
          {appOnlyInviteNote(PRODUCT_NAME)}
        </p>
      )}
      {failed && <pre className="err">{failed}</pre>}
    </div>
  );
}
