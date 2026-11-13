// The fleet's shared light-glass look, first, so the app's own tokens map onto it.
import "@calimero-apps/glass/glass.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { nodeBasename } from "@calimero-apps/node-served";

import App from "./App";
import "./index.css";
import "./app.css";
import { captureInvite } from "./lib/companies";
import { SessionProvider } from "./lib/sessionContext";
import { registerServiceWorker } from "@calimero-apps/install";

// Installable as an app (Chrome, Edge); not in dev and not on a node.
registerServiceWorker();

// An invitation reaches this app as an opened link (`?invite=<token>`, with
// `&audience=<id>` to land in one audience). Taken off the address bar before
// the router can rewrite it, and redeemed once there is a session.
captureInvite();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {/* Local nodes in `vite`, the Calimero Cloud cluster in `vite build`
        (@calimero-apps/connect); replaces mero-react's MeroProvider. */}
    <SessionProvider>
      {/* Under the node's /{version}/ when the cluster serves the bundle's frontend. */}
      <BrowserRouter basename={nodeBasename(new URL(window.location.href), "/")}>
        <App />
      </BrowserRouter>
    </SessionProvider>
  </React.StrictMode>,
);
