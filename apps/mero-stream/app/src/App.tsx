import { type ReactNode, useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { getContextId, clearActiveRoom } from "./lib/session";
import InvitationPrompt from "./components/InvitationPrompt";
import LandingPage from "./pages/LandingPage";
import StreamsPage from "./pages/StreamsPage";
import RoomsPage from "./pages/RoomsPage";
import StreamPage from "./pages/StreamPage";
import CallPage from "./pages/CallPage";

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
    <>
      {/* App level, deliberately. An invitation link can land on ANY route —
          someone with a stored context is redirected to /live on boot — so a
          prompt that lived on the streams page simply never appeared for them.
          Same shape as the bug where room links pointed at a route with no
          redemption code: a handler on one route is a handler that misses. */}
      <InvitationPrompt />
      <Routes>
        {/* Default to /live — the call. `/stream` (64x48, in-WASM toy codec) is
          NOT product surface: it is the measured approach-3 baseline and a real
          Task-3 result, so it stays reachable by URL and unreferenced by any nav
          or switch. Both this and StreamsPage used to send you to /stream, so
          every entry and every reload landed on the 64x48 route and 480p was
          unreachable without hand-editing the URL. */}
        <Route
          path="/"
          element={
            <Navigate to={getContextId() ? "/live" : "/streams"} replace />
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
        {/* Rooms inside one stream. A namespace holds many rooms and each room is
          one call, so the room list needs its own route — the picker used to
          create a namespace and a single context together and could never show a
          second call in the same stream. */}
        <Route
          path="/streams/:namespaceId"
          element={
            <RequireAuth>
              <RoomsPage />
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
        {/* The call: 640x480 H.264 encoded in the browser, carried on ephemeral
          presence. Same auth + stream requirements as /stream. */}
        <Route
          path="/live"
          element={
            <RequireAuth>
              <RequireStream>
                <CallPage />
              </RequireStream>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
