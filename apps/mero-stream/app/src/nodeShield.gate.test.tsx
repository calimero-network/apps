import { render } from "@testing-library/react";
import { nodeShieldGate } from "@calimero-apps/passkey/testing";
import { MemoryRouter } from "react-router-dom";
import { beforeAll } from "vitest";

import App from "./App";
import { SessionProvider } from "./SessionProvider";
import { ToastProvider } from "./contexts/ToastContext";
import { APP } from "./session";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

nodeShieldGate(APP, (deps) =>
  render(
    <SessionProvider deps={deps}>
      <MemoryRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </MemoryRouter>
    </SessionProvider>,
  ),
);
