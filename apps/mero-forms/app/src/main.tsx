import "@calimero-apps/glass/glass.css";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { invites, migrateLegacyInvite } from "./lib/orgs";
import { BASE } from "./route";
import { applyStoredTheme } from "./ui";
import "./index.css";
import { registerServiceWorker } from "@calimero-apps/install";

// Installable as an app (Chrome, Edge); not in dev and not on a node.
registerServiceWorker();

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

// Before React mounts: a person opening an invitation link (`?invite=`) is
// usually not signed in yet, and the token has to survive the passkey sign-up.
// An invite an earlier build stored under its own key moves over first, so a
// fresh link wins.
migrateLegacyInvite();
invites.capture(window.location, { basename: BASE });

// The stored theme on <html> before first paint, so a light-mode user never
// sees a dark flash.
applyStoredTheme();

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
