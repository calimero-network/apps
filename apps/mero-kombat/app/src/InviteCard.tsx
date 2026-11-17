import { useState } from "react";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { InviteDialog } from "@calimero-network/mero-react";

import { arenaInviteBase } from "./arenas";
import type { OpenArena } from "./ArenaPage";

const LABELS = { noun: "arena", title: "Invite to this arena", subtitle: "Choose what your opponent can do." };

/**
 * Invite someone to this arena.
 *
 * An arena lives in an organization, and the invitation makes whoever opens the
 * link a member of it, so they reach this arena and every other one in the same
 * organization. The shared dialog asks the node to approve it; the link also
 * names this arena, which opens once the invitation is accepted.
 */
export function InviteCard({
  client,
  arena,
  passkey,
  after,
}: {
  client: CalimeroClient;
  arena: OpenArena;
  passkey: () => PasskeyProvider;
  after: () => void;
}) {
  const [open, setOpen] = useState(false);
  const org = arena.org;

  return (
    <div className="card invite-card">
      <div className="card-head">
        <h2>Invite an opponent</h2>
      </div>
      {!org ? (
        <p className="hint">
          This arena belongs to your account alone, so nobody else can reach it. Start a new arena
          from the lobby to invite someone.
        </p>
      ) : (
        <>
          <p className="hint">
            One link, for one person: it is single use, so create another for each opponent. Whoever
            opens it joins this arena&apos;s organization, and can take the open corner or watch.
          </p>
          <div className="row">
            <button onClick={() => setOpen(true)}>Invite</button>
          </div>
          <InviteDialog
            open={open}
            onClose={() => setOpen(false)}
            org={org}
            appName="Hyperfeed Kombat"
            labels={LABELS}
            linkBase={arenaInviteBase(arena.appId, org)}
            onInvited={after}
            client={client}
            passkey={passkey()}
          />
        </>
      )}
    </div>
  );
}
