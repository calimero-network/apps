import "@calimero-apps/glass/glass.css";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { basename, dropDeferral, invites, migrateStoredInvite } from "./tables";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

// Before React mounts: a person opening an invitation link is usually not
// signed in yet, and the token has to survive the passkey sign-up. A link
// opened now shows its invitation page again even after "Not now" on an
// earlier one; an invite an older build stored under its own key moves over.
if (invites.capture(window.location, { basename: basename() })) dropDeferral();
migrateStoredInvite(invites);

// StrictMode in dev only. Double-invoking effects is useful for catching
// missing cleanup and actively misleading when you are reading a call log.
const Wrapper = import.meta.env.DEV
  ? StrictMode
  : ({ children }: { children: ReactNode }) => <>{children}</>;

createRoot(root).render(
  <Wrapper>
    <App />
  </Wrapper>,
);
