import "@calimero-apps/glass/glass.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { nodeBasename } from "@calimero-apps/node-served";
import App from "./App";
import { SessionProvider } from "./SessionProvider";
import { ToastProvider } from "./contexts/ToastContext";
import { captureInvite } from "./lib/streams";
import "./index.css";
import { registerServiceWorker } from "@calimero-apps/install";

// Installable as an app (Chrome, Edge); not in dev and not on a node.
registerServiceWorker();

// Before React mounts: whoever opens an invitation link is usually not signed
// in yet, and the token has to survive the passkey sign-up.
captureInvite();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionProvider>
      <BrowserRouter basename={nodeBasename(new URL(window.location.href), "/")}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </SessionProvider>
  </StrictMode>,
);
