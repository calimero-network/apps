import { render } from "@testing-library/react";
import { nodeShieldGate } from "@calimero-apps/passkey/testing";
import { MemoryRouter } from "react-router-dom";

import App from "./App";
import { SessionProvider } from "./api/sessionContext";
import { APP } from "./api/session";

nodeShieldGate(APP, (deps) =>
  render(
    <SessionProvider deps={deps}>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </SessionProvider>,
  ),
);
