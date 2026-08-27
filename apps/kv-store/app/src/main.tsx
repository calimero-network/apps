import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AppMode, MeroProvider } from "@calimero-network/mero-react";
import {
  DeepLinkController,
  PendingIntentStore,
  getBridge,
} from "@calimero-network/mero-platform";
import { __setDeepLinkController } from "@calimero-network/mero-platform-react";
import { App } from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

/**
 * Capture an incoming deep link BEFORE React mounts.
 *
 * This is an IIFE at module scope, not a component effect, and both reasons are
 * load-bearing:
 *
 *  * On a cold invite open the user is not authenticated, so the component that
 *    would consume the invitation never mounts until after the auth reload —
 *    by which time the URL is gone.
 *  * Any router-driven redirect replaces the URL before an effect could read
 *    the query string, and child effects fire before parent effects, so there
 *    is no component early enough to be safe.
 *
 * `PendingIntentStore` makes the capture durable (localStorage) and keeps the
 * intent until the app explicitly acks it, so it survives the login reload and
 * a transient join failure. `__setDeepLinkController` hands the same controller
 * to `useDeepLink`, so the consumer replays a buffered intent that arrived
 * before it existed.
 */
(function primeDeepLinkCapture() {
  try {
    const store = new PendingIntentStore(window.localStorage);
    const controller = new DeepLinkController(store, {
      location: window.location,
      bridge: getBridge(),
      launchQueue:
        (window as unknown as { launchQueue?: unknown }).launchQueue ?? null,
    } as ConstructorParameters<typeof DeepLinkController>[1]);
    __setDeepLinkController(controller);

    // The intent is captured durably now, so drop it from the address bar —
    // otherwise a reload re-captures it and a shared screen shows the payload.
    const params = new URLSearchParams(window.location.search);
    if (params.has("invitation")) {
      params.delete("invitation");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
      );
    }
  } catch {
    // localStorage can throw (private mode, blocked site data) and
    // window.location can be exotic under test. A failure here must not stop
    // the app from starting — it only means this open has no pending invite.
  }
})();

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
    */}
    <MeroProvider mode={AppMode.MultiContext}>
      <App />
    </MeroProvider>
  </Wrapper>,
);
