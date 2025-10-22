import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { BrowserRouter } from "react-router-dom";
import { AppMode, CalimeroProvider } from "@calimero-network/calimero-client";
import { ToastProvider } from "@calimero-network/mero-ui";
import { APPLICATION_ID, APPLICATION_PATH } from "./constants/config.ts";
import ErrorBoundary from "./components/ErrorBoundary.tsx";
import { log } from "./utils/logger.ts";

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((_registration) => {
        log.info('ServiceWorker', 'Service worker registered successfully');
      })
      .catch((error) => {
        log.error('ServiceWorker', 'Service worker registration failed', error);
      });
  });
}

// Disable StrictMode in production to avoid double-rendering
// which can cause 429 errors from CalimeroProvider's auth checks
const AppWrapper = import.meta.env.DEV ? StrictMode : React.Fragment;

createRoot(document.getElementById("root")!).render(
  <AppWrapper>
    <ErrorBoundary onError={(error, errorInfo) => {
      log.error('App', 'Uncaught error in React tree', { error, errorInfo });
    }}>
      <BrowserRouter>
        <CalimeroProvider
          clientApplicationId={APPLICATION_ID}
          mode={AppMode.MultiContext}
          applicationPath={APPLICATION_PATH}
        >
          <ToastProvider>
            <App />
          </ToastProvider>
        </CalimeroProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </AppWrapper>
);
