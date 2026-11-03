import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SessionContext, useSession } from "./session";
// Fonts are bundled, never fetched from Google: offline, and no viewer IPs to a third party.
import "@calimero-apps/glass/fonts.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

// StrictMode in dev only; double-invoked effects mislead when reading a call log.
const Wrapper = import.meta.env.DEV
  ? StrictMode
  : ({ children }: { children: ReactNode }) => <>{children}</>;

/**
 * One session for every screen: the local nodes under `vite` (`pnpm dev:local
 * hyperfeed`), the Calimero Cloud cluster in a production build, signed in
 * with a passkey (packages/connect).
 */
function Session({ children }: { children: ReactNode }) {
  const api = useSession();
  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

createRoot(root).render(
  <Wrapper>
    <Session>
      <App />
    </Session>
  </Wrapper>,
);
