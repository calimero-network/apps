import type { ReactNode } from "react";

import { pendingInvite } from "./tables";
import { SessionContext, defaultDeps, useSession, type SessionDeps } from "./session";

/** One session for the whole app: the landing page, the lobby and the table share it. */
export function SessionProvider({ deps = defaultDeps, children }: { deps?: SessionDeps; children: ReactNode }) {
  const api = useSession(deps, () => pendingInvite()?.token ?? null);
  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}
