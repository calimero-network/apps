import "@calimero-apps/glass/glass.css";
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { captureInvite } from "./lib/spaces";
import "./index.css";

// Before React mounts: a person opening an invitation link is usually not
// signed in yet, and the token has to survive the passkey sign-up.
captureInvite();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
