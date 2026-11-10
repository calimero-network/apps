import { useMemo, useState, type ReactNode } from "react";
import type { InviteStore } from "@calimero-apps/connect";

import { invitedArena, invites as appInvites } from "./arenas";
import {
  InviteContext,
  SessionContext,
  defaultDeps,
  useSession,
  type InviteLanding,
  type SessionDeps,
} from "./session";

/**
 * One session for the whole app: the landing page, the lobby and the arena
 * share it, with the pending invite and where a join lands. A sign-up made
 * with the invite joins its org in that step: the play page opens the arena
 * the link named (else one in that org) once the session is signed in.
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
    setLanding({ org: joined.org ?? pending?.org ?? null, arena: invitedArena(pending) }),
  );
  const inviteState = useMemo(() => ({ invites, landing, setLanding }), [invites, landing]);
  return (
    <SessionContext.Provider value={api}>
      <InviteContext.Provider value={inviteState}>{children}</InviteContext.Provider>
    </SessionContext.Provider>
  );
}
