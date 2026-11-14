import { renderHook } from "@testing-library/react";
import { nodeShieldGate } from "@calimero-apps/passkey/testing";

import { APP_NAME } from "./lib/config";
import { useSession } from "./lib/session";

nodeShieldGate(APP_NAME, (deps) => renderHook(() => useSession(deps)));
