import { type ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { APP_ENABLED } from "./lib/tauri";
import { getContextId } from "./lib/session";
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

// A room (Calimero context) is required for the lobby/call. When the desktop
// opened the app without one, send the user to the room picker instead of a
// dead empty lobby.
function RequireRoom({ children }: { children: ReactNode }) {
  if (!getContextId()) return <Navigate to="/rooms" replace />;
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
