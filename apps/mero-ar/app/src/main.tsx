import "@calimero-apps/glass/glass.css";
import "@calimero-apps/passkey/passkey.css";
import "./index.css";

import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  bounceNativeConsent,
  captureNativeApproval,
  captureNativeSignIn,
  pendingNativeSignIn,
} from "@calimero-apps/passkey/native";

import { App } from "./App";
import { CONSENT_CALLBACK } from "./session";

/*
 * Mero AR's served page. Mero AR is an iPhone app; the cluster serves this page
 * from its bundle on the package's own origin, the only origin a node takes
 * Mero AR's passkey ceremonies from. The app opens it in the system sign-in
 * sheet for three things (`@calimero-apps/passkey/native`):
 *
 * - `#native-sign-in`: sign in or create an account, then hand the session
 *   (bound to Mero AR's package) back to `mero-ar://signed-in`;
 * - `#native-approve`: approve one of Mero AR's step-ups with the passkey,
 *   back to `mero-ar://approved`;
 * - `?native-consent=1`: the node's consent page returning, passed on to
 *   `mero-ar://consent`.
 */
const bounced = bounceNativeConsent(window.location, CONSENT_CALLBACK);
captureNativeSignIn();
const approval = captureNativeApproval();

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

// StrictMode in dev only: double-invoked effects mislead when reading a request log.
const Wrapper = import.meta.env.DEV ? StrictMode : ({ children }: { children: ReactNode }) => <>{children}</>;

if (!bounced) {
  createRoot(root).render(
    <Wrapper>
      <App nativeSignIn={pendingNativeSignIn() !== null} approval={approval} />
    </Wrapper>,
  );
}
