import { useState } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { InviteDialog } from "@calimero-network/mero-react";
import { inviteBase } from "./teams";

const LABELS = { noun: "team", title: "Invite to this team", subtitle: "Choose what your teammates can do." };

/**
 * Invite someone to this team's organization. Whoever opens the link signs in
 * with a passkey and joins it. The shared dialog asks the node to approve it.
 */
export function InviteCard({
  client,
  org,
  passkey,
  after,
}: {
  client: CalimeroClient;
  org: string | null;
  passkey: () => PasskeyProvider;
  after: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card">
      <h2>Invite a teammate</h2>
      {!org ? (
        <p className="empty">This team has no organization, so nobody can be invited to it.</p>
      ) : (
        <>
          <p className="empty" style={{ marginBottom: 14 }}>
            One link, for one person: it is single use, so create another for each teammate. Whoever opens
            it signs in with a passkey, joins this team&apos;s organization and sees its standups and
            decisions; nobody without one can.
          </p>
          <div className="row">
            <button onClick={() => setOpen(true)}>Invite</button>
          </div>
          <InviteDialog
            open={open}
            onClose={() => setOpen(false)}
            org={org}
            appName="Hyperfeed Standup"
            labels={LABELS}
            linkBase={inviteBase(org)}
            onInvited={after}
            client={client}
            passkey={passkey()}
          />
        </>
      )}
    </div>
  );
}
