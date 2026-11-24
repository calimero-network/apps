import { render } from "@testing-library/react";
import { nodeShieldGate } from "@calimero-apps/passkey/testing";

import { App } from "./App";
import { APP } from "./session";

nodeShieldGate(APP, (deps) => render(<App deps={deps} approval={null} />));
