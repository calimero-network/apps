import { type ReactNode, useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { APP_ENABLED } from "./lib/tauri";
import { resolveBootScreen } from "./lib/boot";
import { getContextId, clearActiveRoom } from "./lib/session";
import LandingPage from "./pages/landing/LandingPage";
import DesktopSignInPage from "./pages/DesktopSignInPage";
import TeamsPage from "./pages/TeamsPage";
import RoomsPage from "./pages/RoomsPage";
import LobbyPage from "./pages/LobbyPage";
import CallView from "./call/CallView";
import { CallProvider } from "./call/CallContext";
import { ToastProvider } from "./contexts/ToastContext";
import InvitationPrompt from "./components/InvitationPrompt";

function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useMero();
  // NOT `isAuthenticated ? children : <LandingPage/>`. Inside the desktop the web
  // landing page ("Desktop app required — Get Calimero Desktop") is a dead end:
  // it tells the user to install the app they opened this window from and offers
  // nothing to click. See lib/boot.ts.
  switch (
    resolveBootScreen({ appEnabled: APP_ENABLED, isLoading, isAuthenticated })
  ) {
    case "loading":
      return null; // wait for the auth probe; avoids a flash
    case "web-landing":
      return <LandingPage />;
    case "desktop-signin":
      return <DesktopSignInPage />;
    case "app":
      return <>{children}</>;
  }
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

  if (!ctx) return <Navigate to="/teams" replace />;
  if (exists === null) return null; // verifying — don't flash a dead lobby
  if (!exists) return <Navigate to="/teams" replace />;
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
      {/* Both sit ABOVE the router on purpose. A toast raised by an action that
          navigates would unmount with its page, and an invitation link can land
          on any route — putting the prompt on one page means a link opened from
          a call shows nothing. */}
      <ToastProvider>
        <InvitationPrompt />
        <Routes>
          <Route
            path="/"
            element={
              <Navigate to={getContextId() ? "/lobby" : "/teams"} replace />
            }
          />
          {/* Teams (namespaces) hold rooms; a room is a subgroup plus the context
            that IS the meeting. The picker used to list contexts directly and
            call each one a room, which left nowhere to invite people to: an
            invitation is a NAMESPACE invitation, so with one namespace per room
            every invite was to a single meeting. */}
          <Route
            path="/teams"
            element={
              <RequireAuth>
                <TeamsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/teams/:namespaceId"
            element={
              <RequireAuth>
                <RoomsPage />
              </RequireAuth>
            }
          />
          {/* The old flat path, kept so a bookmark or an open desktop window does
            not 404 into the catch-all. */}
          <Route path="/rooms" element={<Navigate to="/teams" replace />} />
          <Route
            path="/lobby"
            element={
              <RequireAuth>
                <RequireRoom>
                  <LobbyPage />
                </RequireRoom>
              </RequireAuth>
            }
          />
          <Route
            path="/call"
            element={
              <RequireAuth>
                <RequireRoom>
                  <CallView />
                </RequireRoom>
              </RequireAuth>
            }
          />
          {/* ⚠️ These two must be routed even though `/` is not the landing here.
                    This app renders the landing from a guard rather than a route, so
                    without them the catch-all below matches `/docs`, redirects to `/`,
                    and a shared docs link silently shows the overview. Measured — it
                    is how this was found. */}
          {["/docs", "/preview"].map((landingPath) => (
            <Route
              key={landingPath}
              path={landingPath}
              element={<LandingPage />}
            />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </CallProvider>
  );
}
