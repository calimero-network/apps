import { useState } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { InviteDialog } from "@calimero-network/mero-react";
import { inviteBase } from "./groups";
import { LinkIcon, UserPlusIcon } from "./icons";
import { IconTile } from "./ui";

const LABELS = { noun: "group", title: "Invite to this group", subtitle: "Choose what the people you invite can do." };

/**
 * Invite someone to this group's organization. Whoever opens the link signs in
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
      <div className="card-head">
        <IconTile accent>
          <UserPlusIcon size={18} />
        </IconTile>
        <div className="grow">
          <h2>Invite someone</h2>
          <div className="meta">Members can vote and audit every tally</div>
        </div>
      </div>
      {!org ? (
        <p className="hint">This group has no organization, so nobody can be invited to it.</p>
      ) : (
        <>
          <p className="hint">
            One link, for one person: it is single use, so create another for each member. Whoever opens it
            signs in with a passkey, joins this group&apos;s organization and sees its polls.
          </p>
          <button onClick={() => setOpen(true)} style={{ width: "100%" }}>
            <LinkIcon size={16} />
            Invite
          </button>
          <InviteDialog
            open={open}
            onClose={() => setOpen(false)}
            org={org}
            appName="Mero Vote"
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
