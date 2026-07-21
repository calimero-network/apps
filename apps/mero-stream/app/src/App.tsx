import { type ReactNode, useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { APP_ENABLED } from "./lib/tauri";
import { getContextId, clearActiveRoom } from "./lib/session";
import LandingPage from "./pages/LandingPage";
import StreamsPage from "./pages/StreamsPage";
import StreamPage from "./pages/StreamPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useMero();
  if (isLoading) return null; // wait for the auth probe; avoids a flash
  if (!isAuthenticated) return <LandingPage />;
  return <>{children}</>;
}

// Context ids already confirmed to exist on the node during this app load —
// lets the picker ⇄ stream hops skip the admin round-trip.
const verifiedStreams = new Set<string>();

// A stream (Calimero context) is required for the capture page, and it must
// still EXIST on the node. The session persists the last stream across reloads,
// so after a node reset / deletion the restored context id points at nothing —
// without this check the app boots into a dead capture page instead of the
// picker. Mirrors mero-meet's RequireRoom.
function RequireStream({ children }: { children: ReactNode }) {
  const { mero } = useMero();
  const ctx = getContextId();
  const [exists, setExists] = useState<boolean | null>(() =>
    ctx && verifiedStreams.has(ctx) ? true : null,
  );

  useEffect(() => {
    if (!ctx || verifiedStreams.has(ctx) || !mero) return;
    let cancelled = false;
    mero.admin
      .getContexts()
      .then((resp) => {
        const found = (resp.contexts ?? []).some((c) => c.id === ctx);
        if (found) verifiedStreams.add(ctx);
        else clearActiveRoom();
        if (!cancelled) setExists(found);
      })
      .catch(() => {
        // Couldn't reach the node to verify — let the page try rather than
        // bouncing a live deep-link on one flaky request.
        if (!cancelled) setExists(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, mero]);

  if (!ctx) return <Navigate to="/streams" replace />;
  if (exists === null) return null; // verifying — don't flash a dead page
  if (!exists) return <Navigate to="/streams" replace />;
  return <>{children}</>;
}

export default function App() {
  // Web is blocked: Mero Stream needs the desktop app's node + SSO. Outside the
  // desktop shell (or a dev browser session) we only ever render the landing
  // page. See APP_ENABLED in lib/tauri.ts.
  if (!APP_ENABLED) return <LandingPage />;

  return (
    <Routes>
      <Route
        path="/"
        element={<Navigate to={getContextId() ? "/stream" : "/streams"} replace />}
      />
      <Route path="/streams" element={<RequireAuth><StreamsPage /></RequireAuth>} />
      <Route
        path="/stream"
        element={<RequireAuth><RequireStream><StreamPage /></RequireStream></RequireAuth>}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
