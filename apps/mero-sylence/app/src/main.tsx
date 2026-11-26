import "@calimero-apps/glass/glass.css";
// Before anything reads the session: the extension's handoffs (`#native-sign-in`,
// `#native-approve`) are taken out of the address before `session.ts` decides
// whether to keep sessions in memory only.
import "./captureNative";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ConsentPopupReturn } from "@calimero-network/mero-react";
import { registerServiceWorker } from "@calimero-apps/install";
import { App } from "./App";
import { invites } from "./lib/orgs";
import { BASE } from "./route";
import { applyStoredTheme } from "./ui";
import "./index.css";

// Installable as an app (Chrome, Edge); not in dev and not on a node.
registerServiceWorker();

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

// An invitation link (`?invite=`) usually arrives signed out: keep the token through the sign-up.
invites.capture(window.location, { basename: BASE });

applyStoredTheme();

const Wrapper = import.meta.env.DEV ? StrictMode : ({ children }: { children: ReactNode }) => <>{children}</>;

createRoot(root).render(
  <Wrapper>
    <ConsentPopupReturn>
      <App />
    </ConsentPopupReturn>
  </Wrapper>,
);
