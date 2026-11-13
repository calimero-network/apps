import "@calimero-apps/glass/glass.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { captureInvite } from "./utils/inviteLink";
import "./index.css";
import { registerServiceWorker } from "@calimero-apps/install";

// Installable as an app (Chrome, Edge); not in dev and not on a node.
registerServiceWorker();

// Before React mounts: a person opening an invitation link is usually not
// signed in yet, and the token has to survive the passkey sign-up
// (`components/InvitationPrompt` asks before joining).
captureInvite();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
