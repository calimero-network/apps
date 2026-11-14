import { nodeShieldGate } from "@calimero-apps/passkey/testing";
import type { SessionDeps } from "@calimero-apps/passkey";
import { vi } from "vitest";

import { APP, startCalimero } from "./api/calimero";

// The chat connects itself rather than through the session hook, so the gate hands it the fake client.
const gate = vi.hoisted(() => ({ deps: null as SessionDeps | null }));
vi.mock("@calimero-apps/connect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calimero-apps/connect")>()),
  createClient: (target: Parameters<SessionDeps["makeClient"]>[0]) => gate.deps!.makeClient(target),
}));

nodeShieldGate(APP, (deps) => {
  gate.deps = deps;
  void startCalimero();
});
