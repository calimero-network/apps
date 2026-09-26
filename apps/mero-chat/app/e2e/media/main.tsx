// The app's provider tree from src/main.tsx, minus the SSO/deep-link/service
// worker bootstrap (nothing to hand over without a node). MeroProvider is the
// mocked one; everything below it is production code.
import "./seed";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MeroProvider, AppMode } from "@calimero-network/mero-react";
import { ToastProvider } from "@calimero-network/mero-ui";

import "../../src/index.css";
import "@calimero-network/mero-ui/styles.css";
import "react-photo-view/dist/react-photo-view.css";
import App from "../../src/App";
import MeroJsBridge from "../../src/api/MeroJsBridge";
import ErrorBoundary from "../../src/components/ErrorBoundary";
import { WebSocketProvider } from "../../src/contexts/WebSocketContext";

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <MeroProvider mode={AppMode.MultiContext}>
      <MeroJsBridge>
        <BrowserRouter>
          <WebSocketProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </WebSocketProvider>
        </BrowserRouter>
      </MeroJsBridge>
    </MeroProvider>
  </ErrorBoundary>,
);
