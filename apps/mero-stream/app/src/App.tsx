import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { NotFound } from "@calimero-network/mero-js";
import { targetKey } from "@calimero-apps/connect";
import { useSessionApi } from "./session";
import { bind, getContextId, clearActiveRoom } from "./lib/session";
import { pendingInvite } from "./lib/streams";
import InvitationPrompt from "./components/InvitationPrompt";
import SignIn from "./components/SignIn";
import LandingPage from "./pages/landing/LandingPage";
import StreamsPage from "./pages/StreamsPage";
import RoomsPage from "./pages/RoomsPage";
import StreamPage from "./pages/StreamPage";
import CallPage from "./pages/CallPage";

/**
 * Signed in, or the way in: the landing page, whose "connect" opens the
 * passkey sign-in (v1: mero-react's login popup). An opened invitation link
 * goes straight to the sign-in, which says what the person was invited to.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const api = useSessionApi();
  const { session } = api;
  const [signingIn, setSigningIn] = useState(false);

  // Bind the stored active room to this cluster and account before any page
  // reads it.
  const bound = useMemo(() => {
    if (session.status !== "signed-in") return false;
    bind(targetKey(session.target), session.accountId);
    return true;
  }, [session]);

  if (session.status === "connecting") return null; // avoids a flash
  if (session.status === "signed-in" && bound) return <>{children}</>;
  const invite = pendingInvite();
  if (signingIn || invite || session.status === "unconfigured") {
    return <SignIn api={api} invite={invite} />;
  }
  return <LandingPage onConnect={() => setSigningIn(true)} />;
}

// Rooms already confirmed to exist during this app load.
const verifiedRooms = new Set<string>();

/**
 * The active room must still exist: the stored one may have been deleted (or
 * the account removed from its stream). Without this the app boots into a dead
 * call instead of the picker.
 */
function RequireStream({ children }: { children: ReactNode }) {
  const { session } = useSessionApi();
  const client = session.status === "signed-in" ? session.client : null;
  const room = getContextId();
  const [exists, setExists] = useState<boolean | null>(() =>
    room && verifiedRooms.has(room) ? true : null,
  );

  useEffect(() => {
    if (!room || verifiedRooms.has(room) || !client) return;
    let cancelled = false;
    client
      .getApp(room)
      .then(() => {
        verifiedRooms.add(room);
        if (!cancelled) setExists(true);
      })
      .catch((e: unknown) => {
        // Only a definite "no such app" forgets the room; a flaky request
        // lets the page try rather than bouncing a live link.
        const gone = e instanceof NotFound;
        if (gone) clearActiveRoom();
        if (!cancelled) setExists(!gone);
      });
    return () => {
      cancelled = true;
    };
  }, [room, client]);

  if (!room) return <Navigate to="/streams" replace />;
  if (exists === null) return null;
  if (!exists) return <Navigate to="/streams" replace />;
  return <>{children}</>;
}

/** `/`: into the app when signed in, else the landing page and the sign-in. */
function Home() {
  return (
    <RequireAuth>
      <Navigate to={getContextId() ? "/live" : "/streams"} replace />
    </RequireAuth>
  );
}

export default function App() {
  return (
    <>
      {/* App level: an invitation link can land on any route. */}
      <InvitationPrompt />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="/streams"
          element={
            <RequireAuth>
              <StreamsPage />
            </RequireAuth>
          }
        />
        {/* Rooms inside one stream (an organization). */}
        <Route
          path="/streams/:namespaceId"
          element={
            <RequireAuth>
              <RoomsPage />
            </RequireAuth>
          }
        />
        {/* `/stream` (64x48, in-contract toy codec) is NOT product surface: it
          is the measured approach-3 baseline, reachable by URL only. */}
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
        {/* The call: 640x480 H.264 encoded in the browser, carried on presence. */}
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
        {["/docs", "/preview"].map((landingPath) => (
          <Route
            key={landingPath}
            path={landingPath}
            element={<LandingPage />}
          />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
