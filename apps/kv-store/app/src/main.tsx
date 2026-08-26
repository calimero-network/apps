import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AppMode, MeroProvider } from "@calimero-network/mero-react";
import { App } from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

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
