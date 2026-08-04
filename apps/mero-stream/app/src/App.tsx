import { type ReactNode, useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { getContextId, clearActiveRoom } from "./lib/session";
import LandingPage from "./pages/LandingPage";
import StreamsPage from "./pages/StreamsPage";
import StreamPage from "./pages/StreamPage";
import LivePage from "./pages/LivePage";

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
  // No APP_ENABLED short-circuit here any more.
  //
  // It used to be `if (!APP_ENABLED) return <LandingPage />`, which made the web
  // a dead end: without a session in the URL hash the router never mounted, so
  // `RequireAuth` never ran, so mero-react's login was unreachable. The page told
  // visitors to install the desktop app because that was genuinely the only way
  // in — there was no login to reach.
  //
  // Auth is now decided where it belongs: `RequireAuth` renders the landing page
  // (which carries a real ConnectButton) when unauthenticated, and the app when
  // authenticated. The desktop shell and the URL hash still work exactly as
  // before — they just aren't the only options.
  return (
    <Routes>
      <Route
        path="/"
        element={
          <Navigate to={getContextId() ? "/stream" : "/streams"} replace />
        }
      />
      <Route
        path="/streams"
        element={
          <RequireAuth>
            <StreamsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/stream"
        element={
          <RequireAuth>
            <RequireStream>
              <StreamPage />
            </RequireStream>
          </RequireAuth>
        }
      />
      {/* Approach 2: 480p H.264 encoded in the browser, app stores opaque bytes.
          Same auth + stream requirements as /stream; a separate route so the
          measured approach-3 baseline stays reachable and untouched. */}
      <Route
        path="/live"
        element={
          <RequireAuth>
            <RequireStream>
              <LivePage />
            </RequireStream>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
