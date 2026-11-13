import "@calimero-apps/glass/glass.css";
import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { nodeBasename } from "@calimero-apps/node-served";
import { invites, migrateLegacyInvite } from "./lib/spaces";
import "./index.css";
import { registerServiceWorker } from "@calimero-apps/install";

// Installable as an app (Chrome, Edge); not in dev and not on a node.
registerServiceWorker();

// Before React mounts: a person opening an invitation link is usually not
// signed in yet, and the token has to survive the passkey sign-up.
// An invite an earlier build stored under its own key moves over first, so a
// fresh link wins.
migrateLegacyInvite();
invites.capture(window.location, { basename: nodeBasename(new URL(window.location.href), "/") });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
