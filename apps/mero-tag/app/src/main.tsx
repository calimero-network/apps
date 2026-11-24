import "@calimero-apps/glass/glass.css";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { bounceNativeConsent, captureNativeApproval, captureNativeSignIn } from "@calimero-apps/passkey/native";

import { App } from "./App";
import { CONSENT_CALLBACK } from "./session";
import "./index.css";

// The node's consent page returning to the iOS app (`?native-consent=1`):
// pass the answer on to the app and render nothing here.
const bounced = bounceNativeConsent(window.location, CONSENT_CALLBACK);

// Opened by the iOS app to sign in (`#native-sign-in&state=…&key=…`), or to
// approve a change with the passkey (`#native-approve&…`).
captureNativeSignIn();
captureNativeApproval();

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

const Wrapper = import.meta.env.DEV ? StrictMode : ({ children }: { children: ReactNode }) => <>{children}</>;

if (!bounced) {
  createRoot(root).render(
    <Wrapper>
      <App />
    </Wrapper>,
  );
}
