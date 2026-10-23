import "@calimero-apps/glass/glass.css";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AppMode, MeroProvider } from "@calimero-network/mero-react";
import { primeInvitationCapture } from "@calimero-network/mero-react";
import { App } from "./App";
import { applyStoredTheme } from "./ui";
import { adoptDesktopSession } from "./utils/desktopSso";
import { APP_SLUG } from "./utils/invitation";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

/**
 * Capture an incoming invitation BEFORE React mounts.
 *
 * An invitation reaches this app only as an opened link: the links page (or a
 * cold desktop start) appends `?invitation=…` to this URL, and a desktop that is
 * already running sends a `deep-link` event. Both are caught here, at module
 * scope, because on a cold open the user is not authenticated yet — the prompt
 * that consumes it cannot ask until after login — and any redirect would
 * replace the URL before an effect could read it. The capture keeps the
 * invitation durably until it is acked, drops it from the address bar, and
 * ignores a link addressed to another app.
 */
primeInvitationCapture("mero-forms", { slug: APP_SLUG });

// Before React mounts, for the same reason the capture above is: the provider
// resolves the auth callback on its first render, so the initiated node has to
// be in storage by then. Launcher-only, and it seeds the node URL and nothing
// else — see utils/desktopSso.ts.
adoptDesktopSession();

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
    {/*
      Two deliberate non-choices, both of which apps in this fleet got wrong.

      1. NO token seeding, and the URL hash is left alone.
         mero-react has guarded token adoption since 4.3.4
         (`resolveTokenAdoption`) and does it better than an app can: it orders
         by `iat` rather than `exp`, MERGES an access-only hash instead of
         overwriting a live refresh token, and REFUSES an undecodable one.
         Hand-seeding the store and then stripping the hash means the provider
         never sees the callback and none of that runs. Refresh tokens are
         single-use, so re-presenting a consumed one revokes the whole family
         and hard-logs-out every holder.

      2. `AppMode.MultiContext`. `SingleContext` is deprecated: the auth
         callback returns only tokens, application_id and node_url, and the app
         owns context selection — which is what `ContextPicker` below is.

      `packageName` is NOT optional in practice for a hosted deployment.
      The auth frontend only hands the minted tokens back to a callback origin
      it trusts, and for anything that is not loopback or the node's own origin
      that means asking the registry whether this package declares that origin
      as its `links.frontend`. It reads the package from the `package-name`
      login param, which mero-react sends only when this is set — with it unset
      the lookup has nothing to ask about and FAILS CLOSED:

          Login callback destination is not allowed.

      Local dev cannot catch this: loopback short-circuits the whole check, so
      localhost logs in fine and only the deployed origin breaks, after
      credentials are already accepted.
    */}
    <MeroProvider
      mode={AppMode.MultiContext}
      packageName={APP_SLUG}
      // Passed explicitly, as most of the fleet does: kv-store's omission is
      // an open question in docs/SESSION-AND-INVITES.md, not a pattern.
      registryUrl="https://apps.calimero.network"
    >
      <App />
    </MeroProvider>
  </Wrapper>,
);
