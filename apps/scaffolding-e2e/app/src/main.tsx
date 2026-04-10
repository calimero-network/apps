import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import {
  AppMode,
  CalimeroProvider,
  getAppEndpointKey,
  getContextId,
  getJWTObject,
  setAccessToken,
  setAppEndpointKey,
  setContextAndIdentityFromJWT,
  setContextId,
  setExecutorPublicKey,
  setRefreshToken,
} from "@calimero-network/calimero-client";
import "./index.css";
import App from "./App.tsx";

// Pre-process Tauri SSO hash params BEFORE React mounts.
(function bootstrapHashParams() {
  const hash = window.location.hash.slice(1);
  if (hash) {
    const p = new URLSearchParams(hash);
    const nodeUrl = p.get("node_url");
    const accessToken = p.get("access_token");
    const refreshToken = p.get("refresh_token");
    if (nodeUrl) setAppEndpointKey(nodeUrl.trim());
    if (accessToken) {
      setAccessToken(accessToken);
      // Extract context-id and executor-public-key from JWT so RPC calls have a
      // valid contextId. Try the permissions[context[id,key]] format first.
      setContextAndIdentityFromJWT(accessToken);
      // Fallback: use direct JWT payload fields if permissions format didn't work.
      if (!getContextId()) {
        const jwt = getJWTObject();
        if (jwt?.context_id) setContextId(jwt.context_id);
        if (jwt?.context_identity) setExecutorPublicKey(jwt.context_identity);
        else if (jwt?.executor_public_key) setExecutorPublicKey(jwt.executor_public_key);
      }
    }
    if (refreshToken) setRefreshToken(refreshToken);
    if (accessToken || refreshToken) {
      p.delete("access_token");
      p.delete("refresh_token");
      p.delete("expires_in");
      const remaining = p.toString();
      window.history.replaceState(
        null,
        "",
        remaining
          ? `#${remaining}`
          : window.location.pathname + window.location.search,
      );
    }
  }
  // Seed node URL from .env if nothing is stored yet (hash or localStorage).
  const envUrl = import.meta.env.VITE_NODE_URL?.trim();
  if (envUrl && !getAppEndpointKey()) {
    setAppEndpointKey(envUrl);
  }
})();

// Mode 1: direct app ID — set VITE_APP_ID in .env (app already installed on node).
//          Requires logic/res/e2e_kv_store.wasm copied to frontend/public/app.wasm
//          (npm run sync-wasm does this).
// Mode 2: package name — set VITE_APPLICATION_PACKAGE in .env. Auth frontend resolves
//          the app ID from the node's installed packages or the Calimero registry.
// VITE_APP_ID takes priority if both are set.
const appId = import.meta.env.VITE_APP_ID?.trim();
const packageName = import.meta.env.VITE_APPLICATION_PACKAGE?.trim();

const providerProps = appId
  ? {
      clientApplicationId: appId,
      // Serve the WASM from Vite public/ so merod can install it if needed.
      // Run `npm run sync-wasm` to copy logic/res/e2e_kv_store.wasm → public/app.wasm
      applicationPath: `${window.location.origin}/app.wasm`,
    }
  : {
      packageName: packageName ?? "",
      registryUrl: "https://apps.calimero.network",
    };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <CalimeroProvider
        {...providerProps}
        mode={AppMode.MultiContext}
      >
        <App />
      </CalimeroProvider>
    </BrowserRouter>
  </StrictMode>,
);
