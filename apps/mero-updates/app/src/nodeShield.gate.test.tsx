import { render } from "@testing-library/react";
import { nodeShieldGate } from "@calimero-apps/passkey/testing";
import { MemoryRouter } from "react-router-dom";

import App from "./App";
import { APP_NAME } from "./lib/config";
import { SessionProvider } from "./lib/sessionContext";

nodeShieldGate(APP_NAME, (deps) =>
  render(
    <SessionProvider deps={deps}>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </SessionProvider>,
  ),
);
