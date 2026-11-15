import { nodeShieldGate } from "@calimero-apps/passkey/testing";

import { APP, connect } from "../src/net/session";

nodeShieldGate(APP, (deps) => void connect(deps));
