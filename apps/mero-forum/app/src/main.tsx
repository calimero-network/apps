import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppMode, MeroProvider } from "@calimero-network/mero-react";

import App from "./App";
import "./index.css";

// MeroProvider owns SSO: it parses the auth callback out of the URL hash on
// first render, stores the tokens and strips the hash. So the hash is left
// INTACT here — hand-rolling the seeding is what disables
// `resolveTokenAdoption`, and several apps in the fleet quietly downgraded
// themselves that way.
//
// mero-react >= 4.1 also drops a callback whose node_url is not explicitly
// trusted, with only a console error. Every user runs their own node, so the
// only workable anchor is the node_url in THIS open's hash.
const hashNodeUrl = new URLSearchParams(window.location.hash.slice(1)).get("node_url");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MeroProvider
      mode={AppMode.MultiContext}
      // ⚠️ `?.trim() ||`, never `??`. Vercel inlines a defined-but-EMPTY env
      // var as `""`, which `??` happily keeps — and an empty packageName makes
      // `buildAuthLoginUrl` drop the `package-name` param entirely. Without it
      // auth-frontend cannot look the app up in the registry to authorize the
      // callback origin, so a hosted login dies on "Login callback destination
      // is not allowed". That is exactly what shipped on mero-design.
      packageName={import.meta.env.VITE_APPLICATION_PACKAGE?.trim() || "com.calimero.mero-forum"}
      registryUrl="https://apps.calimero.network"
      allowedNodeUrls={hashNodeUrl ? [hashNodeUrl] : undefined}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MeroProvider>
  </React.StrictMode>,
);
