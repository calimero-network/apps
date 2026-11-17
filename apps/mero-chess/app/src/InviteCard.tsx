import { useState } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { InviteDialog } from "@calimero-network/mero-react";

import type { OpenTable } from "./TablePage";
import { tableInviteBase } from "./tables";

const LABELS = { noun: "table", title: "Invite to this table", subtitle: "Choose what your opponent can do." };

/**
 * Invite someone to this table.
 *
 * A table lives in an organization, and the invitation makes whoever opens the
 * link a member of it, so they reach this table and every other one in the same
 * organization. The shared dialog asks the node to approve it; the link also
 * names this table, which opens once the invitation is accepted.
 */
export function InviteCard({
  client,
  table,
  passkey,
  after,
  from,
}: {
  client: CalimeroClient;
  table: OpenTable;
  /** The inviter as the invitee is told: "Join {from}'s game as ...?". */
  from?: string | null;
  passkey: () => PasskeyProvider;
  after: () => void;
}) {
  const [open, setOpen] = useState(false);
  const org = table.org;

  return (
    <div className="card invite-card">
      <div className="card-head">
        <h2>Invite an opponent</h2>
      </div>
      {!org ? (
        <p className="hint">
          This table belongs to your account alone, so nobody else can reach it. Start a new table
          from the lobby to invite someone.
        </p>
      ) : (
        <>
          <p className="hint">
            One link. Whoever opens it joins this table&apos;s organization, and can take the free
            seat or watch.
          </p>
          <div className="row">
            <button onClick={() => setOpen(true)}>Invite</button>
          </div>
          <InviteDialog
            open={open}
            onClose={() => setOpen(false)}
            org={org}
            appName="Hyperfeed Chess"
            labels={LABELS}
            inviterName={from ?? undefined}
            linkBase={tableInviteBase(table.appId, org, from)}
            onInvited={after}
            client={client}
            passkey={passkey()}
          />
        </>
      )}
    </div>
  );
}
