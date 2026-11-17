import { useState } from "react";
import { InviteDialog } from "@calimero-network/mero-react";
import { appInviteTeams, appOnlyInviteNote, describeError } from "@calimero-apps/connect";
import { PRODUCT_NAME, inviteLinkBase } from "./lib/orgs";
import { PersonName, useOrg } from "./names";
import { useSignedIn } from "./sessionContext";
import { Avatar } from "./ui";
import { useRead, type Workspace } from "./useWorkspace";
import { toTeam, done } from "./formsApi";

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
  const team = useRead(workspace.client, workspace.version, (c) => c.listTeam().then(toTeam), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onTeam = new Set((team.data ?? []).map((m) => m.account));
  // Who has Hyperfeed Forms in the org (its app team, else the org): only they reach the workspace.
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
                  onClick={() => run(m.account, () => workspace.act((c) => c.removeTeamMember({ who: m.account }).then(done)))}
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
                      await workspace.act((c) => c.addTeamMember({ who: account }).then(done));
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
 * Make a shareable invitation into this workspace's organization through the
 * shared dialog: an org invite approved by the node's consent page, in a link
 * that opens this app and lands in this workspace. Whoever opens it joins the
 * org; add them to the team above to give them the forms.
 */
export function InviteCard({ org, appId }: { org: string; appId: string }) {
  const { client, passkey, source } = useSignedIn();
  const [invite, setInvite] = useState<{ teams: string[]; appOnly: boolean } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function open() {
    setFailed(null);
    try {
      setInvite(await appInviteTeams(client, org, source));
    } catch (e) {
      setFailed(describeError(e));
    }
  }

  return (
    <div className="card">
      <h2>Invite a teammate</h2>
      <p className="empty" style={{ marginBottom: 14 }}>
        One link, approved by your node. Whoever opens it signs in with a passkey and joins
        this workspace&apos;s organization; add them to the team above to give them the forms.
        Single use: one person can join with this link. Generate another for each person you invite.
      </p>
      <div className="row">
        <button onClick={() => void open()}>Create invite link</button>
      </div>
      {failed && <pre className="err">{failed}</pre>}
      <InviteDialog
        client={client}
        passkey={passkey()}
        open={invite !== null}
        onClose={() => setInvite(null)}
        org={org}
        teams={invite?.teams}
        appName={PRODUCT_NAME}
        labels={{
          title: "Invite to this workspace",
          subtitle: "Choose what the people you invite can do in this organization.",
          note: invite?.appOnly ? appOnlyInviteNote(PRODUCT_NAME) : undefined,
        }}
        linkBase={inviteLinkBase(appId, org)}
      />
    </div>
  );
}
