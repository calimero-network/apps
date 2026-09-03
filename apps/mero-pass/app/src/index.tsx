import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppMode, MeroProvider } from "@calimero-network/mero-react";
import { ToastProvider } from "@calimero-network/mero-ui";
import "@calimero-network/mero-ui/styles.css";
import "./index.css";
import "./styles/utilities.css";
import App from "./App";

// ── Desktop SSO ───────────────────────────────────────────────────────────────
//
// tauri-app opens this app in a WebviewWindow with the session in the URL hash:
//
//   …#node_url=…&access_token=…&refresh_token=…&app-id=…&expires_at=…
//
// SSO is owned by MeroProvider, NOT by us: on first render it runs
// `parseAuthCallback(window.location.href)`, reads the tokens out of the hash,
// stores them in mero-js's token store and strips the hash. So the hash must be
// left INTACT here — hand-rolling the seeding is what disables
// `resolveTokenAdoption`, and several apps in the fleet quietly downgraded
// themselves that way.
//
// mero-react >= 4.1 also REJECTS a callback whose node_url is not explicitly
// trusted, dropping the tokens with nothing but a console error. Every user runs
// their own node, so the only workable trust anchor is the node_url the desktop
// handed us in THIS open's hash — read before MeroProvider strips it.
const hashNodeUrl = new URLSearchParams(window.location.hash.slice(1)).get(
  "node_url",
);

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);
root.render(
  <React.StrictMode>
    <MeroProvider
      mode={AppMode.MultiContext}
      // The registry resolves the installed application per node. The old code
      // hard-coded a `clientApplicationId` — an ApplicationId is assigned PER
      // INSTALL, so a baked one is wrong on every node but the machine it was
      // copied from, and core answers a request naming an unknown application
      // with an opaque 500 rather than a 404.
      packageName={
        import.meta.env.VITE_APPLICATION_PACKAGE ?? "com.calimero.mero-pass"
      }
      registryUrl="https://apps.calimero.network"
      allowedNodeUrls={hashNodeUrl ? [hashNodeUrl] : undefined}
    >
      <ToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ToastProvider>
    </MeroProvider>
  </React.StrictMode>,
);
