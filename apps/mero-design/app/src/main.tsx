import "@calimero-apps/glass/glass.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConsentPopupReturn } from "@calimero-network/mero-react";
import App from "./App";
import { captureInvite } from "./utils/inviteLink";
import "./index.css";

// Before React mounts: a person opening an invitation link is usually not
// signed in yet, and the token has to survive the passkey sign-up
// (`components/InvitationPrompt` asks before joining).
captureInvite();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConsentPopupReturn>
      <App />
    </ConsentPopupReturn>
  </StrictMode>,
);
