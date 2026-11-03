import "./styles/normalize.css";
// The fleet's shared light-glass look. First, so this app's own stylesheets
// (styles/theme.css maps its tokens onto these) override it, never the reverse.
import "@calimero-apps/glass/glass.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { nodeBasename } from "@calimero-apps/node-served";
import "@calimero-network/mero-ui/styles.css";

import App from "./App";
import { SessionProvider } from "./api/sessionContext";
import { captureInvite } from "./api/teams";
import "./styles/theme.css";
import "./index.module.scss";
import { Provider as StoreProvider } from "react-redux";
import { store } from "./store/store";
import { ModalProvider } from "./providers/ModalProvider";
import { PopupProvider } from "./providers/PopupProvider";
import { ThemeProvider } from "./providers/ThemeProvider";

// Before React mounts: a person opening an invitation link (`?invite=`) is
// usually not signed in yet, and the token has to survive the passkey sign-up.
captureInvite();

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <React.StrictMode>
    {/* Local nodes in dev (`pnpm dev:local mero-calendar`), the Calimero Cloud
        cluster in a production build; see @calimero-apps/connect. */}
    <SessionProvider>
      <ThemeProvider>
        <StoreProvider store={store}>
          <ModalProvider>
            <PopupProvider>
              {/* The cluster serves the bundled frontend under its own path. */}
              <BrowserRouter basename={nodeBasename(new URL(window.location.href), "/")}>
                <App />
              </BrowserRouter>
            </PopupProvider>
          </ModalProvider>
        </StoreProvider>
      </ThemeProvider>
    </SessionProvider>
  </React.StrictMode>,
);
