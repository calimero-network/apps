import { renderHook } from "@testing-library/react";
import { nodeShieldGate } from "@calimero-apps/passkey/testing";

import { APP, useSession } from "./session";

// Not the root: the test project leaves App.tsx out, with the generated landing page it imports.
nodeShieldGate(APP, (deps) => renderHook(() => useSession(deps)));
