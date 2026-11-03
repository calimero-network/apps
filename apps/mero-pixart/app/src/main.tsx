import "@calimero-apps/glass/glass.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { nodeBasename } from "@calimero-apps/node-served";
import "@calimero-network/mero-ui/styles.css";
import App from "./App";
import { SessionProvider } from "./api/sessionContext";
import { captureInvite } from "./api/teams";
import "./index.css";

// Before React mounts: a person opening an invitation link (`?invite=`) is
// usually not signed in yet, and the token has to survive the passkey sign-up.
captureInvite();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Local nodes in dev (`pnpm dev:local mero-pixart`), the Calimero Cloud
        cluster in a production build; see @calimero-apps/connect. */}
    <SessionProvider>
      {/* The cluster serves the bundled frontend under its own path. */}
      <BrowserRouter basename={nodeBasename(new URL(window.location.href), "/")}>
        <App />
      </BrowserRouter>
    </SessionProvider>
  </StrictMode>,
);
