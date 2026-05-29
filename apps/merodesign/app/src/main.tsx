import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { useAuthStore } from "./store/authStore";
import "./index.css";

// ── Tauri desktop SSO: read auth tokens from URL hash before React mounts ──────
//
// tauri-app opens MeroDesign with a URL like:
//   http://localhost:5173#node_url=...&access_token=...&refresh_token=...
//                        &app-id=...&context_id=...&expires_at=...
//
// We write them straight into the Zustand auth store (which persists to
// localStorage) so RequireAuth sees authenticated=true on first render.
// The hash is stripped and, if a context_id was provided, the URL path is
// rewritten so React Router lands directly on that canvas.
function readHashAuth() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;

  const p = new URLSearchParams(hash);
  const nodeUrl = p.get("node_url")?.trim();
  const accessToken = p.get("access_token");
  const refreshToken = p.get("refresh_token");
  const applicationId = p.get("app-id") ?? "";
  const contextId = p.get("context_id");

  if (!nodeUrl || !accessToken || !refreshToken) return;

  // Overwrite whatever was previously stored — tauri tokens take precedence
  useAuthStore.getState().setAuth(nodeUrl, accessToken, refreshToken, applicationId);

  // Navigate to the specific canvas if tauri told us which project to open.
  // Use "t" as the placeholder teamId — CanvasPage only needs projectId to work;
  // teamId is only used by the Back button.
  const targetPath = contextId
    ? `/teams/t/projects/${contextId}`
    : "/teams";

  // Replace URL: strips the hash and sets the correct path before React Router reads it
  window.history.replaceState({}, "", targetPath);
}

readHashAuth();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
