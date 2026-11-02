import "@calimero-apps/glass/glass.css";
import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@calimero-network/mero-ui/styles.css";
import { ToastProvider } from "@calimero-network/mero-ui";
import "react-photo-view/dist/react-photo-view.css";

import "./index.css";
import App from "./App.tsx";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import { WebSocketProvider } from "./contexts/WebSocketContext.tsx";
import { captureInvite } from "./calimero/workspace.ts";
import { log } from "./utils/logger.ts";
import { purgeLegacyIdentityDisplayNames } from "./utils/messengerName.ts";
import { nodeBasename } from "./utils/servedByNode.ts";
import { applyTheme, readStoredTheme } from "./theme/theme.ts";

// index.html already set the theme before paint; this keeps the meta colour
// and attribute right if that inline script was skipped (a cached shell).
applyTheme(readStoredTheme());
purgeLegacyIdentityDisplayNames();

// Before React mounts: a person opening an invitation link is usually not signed
// in yet, and the token has to survive the passkey sign-up.
captureInvite();

// StrictMode in dev only: double-invoked effects help find missing cleanup and
// mislead when reading a request log.
const AppWrapper = import.meta.env.DEV ? StrictMode : React.Fragment;

createRoot(document.getElementById("root")!).render(
  <AppWrapper>
    <ErrorBoundary
      onError={(error, errorInfo) => {
        log.error("App", "Uncaught error in React tree", { error, errorInfo });
      }}
    >
      <BrowserRouter basename={nodeBasename()}>
        <WebSocketProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </WebSocketProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </AppWrapper>,
);
