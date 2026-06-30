import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import {
  MeroProvider,
  AppMode as MeroAppMode,
  setNodeUrl,
  setApplicationId,
} from "@calimero-network/mero-react";
import "@calimero-network/mero-ui/styles.css";

import App from "./App";
import "./styles/theme.css";
import "./index.module.scss";
import { Provider as StoreProvider } from "react-redux";
import { store } from "./store/store";
import { ModalProvider } from "./providers/ModalProvider";
import { PopupProvider } from "./providers/PopupProvider";
import { ThemeProvider } from "./providers/ThemeProvider";

// ── Tauri desktop SSO: read auth tokens from the URL hash before React mounts ──
//
// On the web, Mero Calendar goes through the node's real auth flow
// (ConnectButton → /auth/login redirect → callback hash, which MeroProvider
// consumes itself). We must NOT pre-process the hash there or it races
// MeroProvider. Only the Tauri desktop skips auth: tauri-app opens a window with
//   merocalendar://…#node_url=…&access_token=…&refresh_token=…&application_id=…
const IS_TAURI = "__TAURI_INTERNALS__" in window;

function persistTauriHashAuth() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;

  const p = new URLSearchParams(hash);
  const nodeUrl = p.get("node_url")?.trim();
  const accessToken = p.get("access_token");
  const refreshToken = p.get("refresh_token");
  const applicationId = (p.get("application_id") ?? p.get("app-id") ?? "").trim();
  const expiresAt = p.get("expires_at");

  if (!nodeUrl || !accessToken || !refreshToken) return;

  setNodeUrl(nodeUrl);
  if (applicationId) setApplicationId(applicationId);
  localStorage.setItem(
    "mero-tokens",
    JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt ? parseInt(expiresAt, 10) : Date.now() + 3600_000,
    }),
  );

  // Land on the teams list; the user picks a team → calendar.
  window.history.replaceState({}, "", "/teams");
}

if (IS_TAURI) persistTauriHashAuth();

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <React.StrictMode>
    <MeroProvider
      mode={MeroAppMode.MultiContext}
      packageName={import.meta.env.VITE_APPLICATION_PACKAGE ?? "com.calimero.merocalendar"}
      registryUrl="https://apps.calimero.network"
    >
      <ThemeProvider>
        <StoreProvider store={store}>
          <ModalProvider>
            <PopupProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </PopupProvider>
          </ModalProvider>
        </StoreProvider>
      </ThemeProvider>
    </MeroProvider>
  </React.StrictMode>,
);
