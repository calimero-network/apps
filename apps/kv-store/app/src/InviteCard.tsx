import { useState } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { InviteDialog } from "@calimero-network/mero-react";

import { inviteRoot } from "./stores";

const LABELS = {
  title: "Invite to this store",
  subtitle: "Choose what the people you invite can do in this store's organization.",
  next: "Create invite link",
};

/** Invite a member into the store's organization, through the shared dialog. */
export function InviteCard({
  client,
  org,
  passkey,
}: {
  client: CalimeroClient;
  org: string | null;
  passkey: () => PasskeyProvider;
}) {
  const [open, setOpen] = useState(false);

  if (!org) {
    return (
      <div className="card">
        <h2>Invite</h2>
        <p className="empty">This store is private. Create a shared store to invite others.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Invite</h2>
      <p className="empty" style={{ marginBottom: 10 }}>
        A link that makes whoever opens it a member of this store&apos;s organization. It is single use:
        create another for each person you invite.
      </p>
      <button className="ghost" onClick={() => setOpen(true)}>
        Create an invitation link
      </button>
      <InviteDialog
        client={client}
        passkey={passkey()}
        open={open}
        onClose={() => setOpen(false)}
        org={org}
        appName="KV Store"
        labels={LABELS}
        linkBase={inviteRoot(org)}
      />
    </div>
  );
}
