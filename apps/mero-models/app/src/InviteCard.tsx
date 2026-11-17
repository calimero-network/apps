import { useState } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { InviteDialog } from "@calimero-network/mero-react";
import { inviteBase } from "./scenes";

const LABELS = { noun: "studio", title: "Invite to this scene", subtitle: "Choose what the people you invite can do in this studio." };

/**
 * Invite someone to this scene's studio (its organization). One link: whoever
 * opens it signs in with a passkey and joins the organization, which reaches
 * every scene in it. The shared dialog asks the node to approve it.
 */
export function InviteCard({
  client,
  org,
  passkey,
  after = () => {},
}: {
  client: CalimeroClient;
  org: string | null;
  passkey: () => PasskeyProvider;
  after?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="card invite-card">
      <div className="card-head">
        <h3>Invite someone</h3>
      </div>
      {!org ? (
        <p className="hint">This scene has no organization, so nobody can be invited to it.</p>
      ) : (
        <>
          <p className="hint">
            One link, for one person: it is single use, so create another for each member. Whoever opens it signs
            in with a passkey and joins this scene&apos;s studio, so this scene and every other scene in it open for
            them.
          </p>
          <div className="row">
            <button onClick={() => setOpen(true)}>Invite</button>
          </div>
          <InviteDialog
            open={open}
            onClose={() => setOpen(false)}
            org={org}
            appName="Hyperfeed Models"
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
