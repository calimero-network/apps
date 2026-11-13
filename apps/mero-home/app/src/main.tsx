import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import "@calimero-apps/glass/glass.css";
import "@calimero-apps/passkey/passkey.css";
import { App } from "./App";
import { invites } from "./invites";
import "./index.css";
import { registerServiceWorker } from "@calimero-apps/install";

// Installable as an app (Chrome, Edge); not in dev and not on a node.
registerServiceWorker();

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

// Before React mounts: a person opening an invitation link is usually not
// signed in yet, and the token has to survive the passkey sign-up.
invites.capture(window.location, { basename: window.location.pathname });

const Wrapper = import.meta.env.DEV
  ? StrictMode
  : ({ children }: { children: ReactNode }) => <>{children}</>;

createRoot(root).render(
  <Wrapper>
    <App />
  </Wrapper>,
);
