import { type ReactNode, useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { APP_ENABLED } from "./lib/tauri";
import { getContextId, clearActiveRoom } from "./lib/session";
import LandingPage from "./pages/LandingPage";
import RoomsPage from "./pages/RoomsPage";
import LobbyPage from "./pages/LobbyPage";
import CallView from "./call/CallView";
import { CallProvider } from "./call/CallContext";

function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useMero();
  if (isLoading) return null; // wait for the auth probe; avoids a flash
  if (!isAuthenticated) return <LandingPage />;
  return <>{children}</>;
}

// Context ids already confirmed to exist on the node during this app load —
// lets lobby ⇄ call hops skip the admin round-trip (and the blank frame).
const verifiedRooms = new Set<string>();

// A room (Calimero context) is required for the lobby/call, and it must still
// EXIST on the node. The session persists the last room across reloads, so
// after a node reset / room deletion the restored context id points at
// nothing — without this check the app boots into a dead empty lobby
// ("Room", no members, invite/call that go nowhere) instead of the picker.
function RequireRoom({ children }: { children: ReactNode }) {
  const { mero } = useMero();
  const ctx = getContextId();
  const [exists, setExists] = useState<boolean | null>(() =>
    ctx && verifiedRooms.has(ctx) ? true : null,
  );

  useEffect(() => {
    if (!ctx || verifiedRooms.has(ctx) || !mero) return;
    let cancelled = false;
    mero.admin
      .getContexts()
      .then((resp) => {
        const found = (resp.contexts ?? []).some((c) => c.id === ctx);
        if (found) verifiedRooms.add(ctx);
        else clearActiveRoom();
        if (!cancelled) setExists(found);
      })
      .catch(() => {
        // Couldn't reach the node to verify — let the lobby try rather than
        // bouncing a live deep-link on one flaky request.
        if (!cancelled) setExists(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, mero]);

  if (!ctx) return <Navigate to="/rooms" replace />;
  if (exists === null) return null; // verifying — don't flash a dead lobby
  if (!exists) return <Navigate to="/rooms" replace />;
  return <>{children}</>;
}

export default function App() {
  // Web is blocked: Mero Meet needs the desktop app's node + SSO + media bridge.
  // Outside the desktop shell (or a dev browser session) we only ever render the
  // landing page. See APP_ENABLED in lib/tauri.ts.
  if (!APP_ENABLED) return <LandingPage />;

  // CallProvider holds the live call above the router so it survives navigation
  // (minimize → browse the lobby while the call keeps running as a mini-call).
  return (
    <CallProvider>
      <Routes>
        <Route path="/" element={<Navigate to={getContextId() ? "/lobby" : "/rooms"} replace />} />
        <Route path="/rooms" element={<RequireAuth><RoomsPage /></RequireAuth>} />
        <Route path="/lobby" element={<RequireAuth><RequireRoom><LobbyPage /></RequireRoom></RequireAuth>} />
        <Route path="/call" element={<RequireAuth><RequireRoom><CallView /></RequireRoom></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </CallProvider>
  );
}
