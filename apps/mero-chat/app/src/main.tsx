import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { BrowserRouter } from "react-router-dom";
import { AppMode, CalimeroProvider } from "@calimero-network/calimero-client";
import { ToastProvider } from "@calimero-network/mero-ui";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import { WebSocketProvider } from "./contexts/WebSocketContext.tsx";
import { log } from "./utils/logger.ts";

import 'react-photo-view/dist/react-photo-view.css';

// Register service worker for PWA
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((_registration) => {
        log.info("ServiceWorker", "Service worker registered successfully");
      })
      .catch((error) => {
        log.error("ServiceWorker", "Service worker registration failed", error);
      });
  });
}

// Disable StrictMode in production to avoid double-rendering
// which can cause 429 errors from CalimeroProvider's auth checks
const AppWrapper = import.meta.env.DEV ? StrictMode : React.Fragment;

createRoot(document.getElementById("root")!).render(
  <AppWrapper>
    <ErrorBoundary
      onError={(error, errorInfo) => {
        log.error("App", "Uncaught error in React tree", { error, errorInfo });
      }}
    >
      <BrowserRouter>
        <CalimeroProvider
          packageName={import.meta.env.VITE_APPLICATION_PACKAGE}
          registryUrl="https://apps.calimero.network"
          mode={AppMode.MultiContext}
        >
          <WebSocketProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </WebSocketProvider>
        </CalimeroProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </AppWrapper>,
);
