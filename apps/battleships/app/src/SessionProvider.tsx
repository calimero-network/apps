import { useMemo, useState, type ReactNode } from "react";
import type { InviteStore } from "@calimero-apps/connect";

import { invitedLobby, invites as appInvites } from "./lobbies";
import {
  InviteContext,
  SessionContext,
  defaultDeps,
  useSession,
  type InviteLanding,
  type SessionDeps,
} from "./session";

/**
 * One session for the whole app: the landing page, the lobby and the match
 * share it, with the pending invite and where a join lands. A sign-up made
 * from the invitation page joins its org in that step: the lobby page opens
 * the lobby the link named (else one in that org) once signed in.
 */
export function SessionProvider({
  deps = defaultDeps,
  invites = appInvites,
  children,
}: {
  deps?: SessionDeps;
  invites?: InviteStore;
  children: ReactNode;
}) {
  const [landing, setLanding] = useState<InviteLanding | null>(null);
  const api = useSession(deps, invites, (joined, pending) =>
    setLanding({ org: joined.org ?? pending?.org ?? null, lobby: invitedLobby(pending) }),
  );
  const inviteState = useMemo(() => ({ invites, landing, setLanding }), [invites, landing]);
  return (
    <SessionContext.Provider value={api}>
      <InviteContext.Provider value={inviteState}>{children}</InviteContext.Provider>
    </SessionContext.Provider>
  );
}
