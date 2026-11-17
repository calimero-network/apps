import "@calimero-apps/glass/glass.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConsentPopupReturn } from "@calimero-network/mero-react";
import App from "./App";
import { captureInvite } from "./utils/inviteLink";
import { captureConsentReturn } from "./api/consent";
import "./index.css";
import { registerServiceWorker } from "@calimero-apps/install";

// Installable as an app (Chrome, Edge); not in dev and not on a node.
registerServiceWorker();

// Before React mounts: a person opening an invitation link is usually not
// signed in yet, and the token has to survive the passkey sign-up
// (`components/InvitationPrompt` asks before joining).
captureInvite();
// Likewise a return from the node's consent page (`api/consent.ts`): the root
// sends a signed-in visitor on, dropping the parameters it carries.
captureConsentReturn();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConsentPopupReturn>
      <App />
    </ConsentPopupReturn>
  </StrictMode>,
);
