import { useEffect, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import { InviteCard } from "./InviteCard";
import { PersonName } from "./names";
import { Avatar } from "./ui";
import { useRead, type Inbox } from "./useInbox";

/**
 * Who can work the leads, and how to bring someone in.
 *
 * Joining the namespace is not joining the team: a namespace member can see
 * that the inbox exists, but only the team (the admins and the `team` role)
 * reads and edits leads. So an admin brings someone in in two steps — the
 * invitation link, then "Add to team" once they appear below as a member.
 * Form keys are members too, and are never offered.
 */
export function TeamCard({
  inbox,
  contextId,
  namespaceId,
  isAdmin,
  me,
}: {
  inbox: Inbox;
  contextId: string;
  namespaceId: string | null;
  isAdmin: boolean;
  me: string | null;
}) {
  const { admin } = useMero();
  const team = useRead(inbox.client, inbox.version, (c) => c.listTeam(), []);
  const keys = useRead(
    inbox.client,
    inbox.version,
    (c) => (isAdmin ? c.listFormKeys() : Promise.resolve([])),
    [isAdmin],
  );
  const [members, setMembers] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!admin || !namespaceId || !isAdmin) return;
    let live = true;
    admin
      .listGroupMembers(namespaceId)
      .then((r) => live && setMembers(r.members.map((m) => m.identity.toLowerCase())))
      .catch(() => live && setMembers([]));
    return () => {
      live = false;
    };
  }, [admin, namespaceId, isAdmin, inbox.version]);

  const onTeam = new Set((team.data ?? []).map((m) => m.account));
  const isKey = new Set((keys.data ?? []).map((k) => k.account));
  const candidates = (members ?? []).filter((a) => !onTeam.has(a) && !isKey.has(a));

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
        <p className="empty">The team reads every lead and moves them through the pipeline.</p>
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
                  onClick={() => run(m.account, () => inbox.act((c) => c.removeTeamMember({ who: m.account })))}
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
            People who joined the namespace with an invitation. Add them to give them the inbox.
          </p>
          {members === null && <p className="empty">Loading members…</p>}
          {members !== null && candidates.length === 0 && (
            <p className="empty">Nobody waiting. Send an invitation below.</p>
          )}
          <ul className="people-list">
            {candidates.map((account) => (
              <li key={account} className="person-row">
                <Avatar account={account} size={28} />
                <span className="person-name">
                  <PersonName account={account} />
                </span>
                <button
                  disabled={busy === account}
                  onClick={() => run(account, () => inbox.act((c) => c.addTeamMember({ who: account })))}
                >
                  {busy === account ? "Adding…" : "Add to team"}
                </button>
              </li>
            ))}
          </ul>
          {error && <pre className="err">{error}</pre>}
        </section>
      )}

      {isAdmin && <InviteCard contextId={contextId} />}
    </>
  );
}
