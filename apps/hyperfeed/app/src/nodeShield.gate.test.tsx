import { render } from "@testing-library/react";
import { nodeShieldGate } from "@calimero-apps/passkey/testing";
import type { ReactNode } from "react";

import { App } from "./App";
import { APP, SessionContext, useSession, type SessionDeps } from "./session";

function Session({ deps, children }: { deps: SessionDeps; children: ReactNode }) {
  return <SessionContext.Provider value={useSession(deps)}>{children}</SessionContext.Provider>;
}

nodeShieldGate(APP, (deps) =>
  render(
    <Session deps={deps}>
      <App />
    </Session>,
  ),
);
