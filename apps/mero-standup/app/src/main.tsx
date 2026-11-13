import "@calimero-apps/glass/glass.css";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { invites, migrateStoredInvite } from "./teams";
import { applyStoredTheme } from "./ui";
import "./index.css";
import { registerServiceWorker } from "@calimero-apps/install";

// Installable as an app (Chrome, Edge); not in dev and not on a node.
registerServiceWorker();

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

// Before React mounts: a person opening an invitation link is usually not
// signed in yet, and the token has to survive the passkey sign-up.
// The page's own path is its root (no router): a version-pinned link names no
// route. An invite an older build stored under its own key moves over.
invites.capture(window.location, { basename: window.location.pathname });
migrateStoredInvite(invites);

// The stored theme on <html> before first paint, so a light-mode user never
// sees a dark flash.
applyStoredTheme();

// StrictMode in dev only. Double-invoking effects is useful for catching
// missing cleanup and actively misleading when you are reading a request log.
const Wrapper = import.meta.env.DEV
  ? StrictMode
  : ({ children }: { children: ReactNode }) => <>{children}</>;

createRoot(root).render(
  <Wrapper>
    <App />
  </Wrapper>,
);
