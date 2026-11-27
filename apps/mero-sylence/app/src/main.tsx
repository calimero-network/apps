import "@calimero-apps/glass/glass.css";
// Before anything reads the session: the extension's handoffs (`#native-sign-in`,
// `#native-approve`) are taken out of the address before `session.ts` decides
// whether to keep sessions in memory only.
import "./captureNative";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ConsentPopupReturn } from "@calimero-network/mero-react";
import { App } from "./App";
import { closeSharedDialogsOnBackdrop } from "./backdropClose";
import { invites } from "./lib/orgs";
import { BASE } from "./route";
import { applyStoredTheme } from "./ui";
import "./index.css";

// Earlier builds installed as an app with a service worker that cached the page.
// That is gone: drop any worker and cache an earlier visit left behind.
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((regs) => Promise.all(regs.map((r) => r.unregister())))
    .catch(() => undefined);
}
if (typeof caches !== "undefined") {
  void caches
    .keys()
    .then((keys) => Promise.all(keys.filter((k) => k.includes("mero-sylence") || k.startsWith("workbox")).map((k) => caches.delete(k))))
    .catch(() => undefined);
}

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

// An invitation link (`?invite=`) usually arrives signed out: keep the token through the sign-up.
invites.capture(window.location, { basename: BASE });

applyStoredTheme();
closeSharedDialogsOnBackdrop();

const Wrapper = import.meta.env.DEV ? StrictMode : ({ children }: { children: ReactNode }) => <>{children}</>;

createRoot(root).render(
  <Wrapper>
    <ConsentPopupReturn>
      <App />
    </ConsentPopupReturn>
  </Wrapper>,
);
