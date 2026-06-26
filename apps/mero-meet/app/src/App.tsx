import { type ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { IS_TAURI } from "./lib/tauri";
import { getContextId } from "./lib/session";
import LandingPage from "./pages/LandingPage";
import RoomsPage from "./pages/RoomsPage";
import LobbyPage from "./pages/LobbyPage";
import CallPage from "./pages/CallPage";

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
  // Outside Tauri we only ever render the landing page.
  if (!IS_TAURI) return <LandingPage />;

  return (
    <Routes>
      <Route path="/" element={<Navigate to={getContextId() ? "/lobby" : "/rooms"} replace />} />
      <Route path="/rooms" element={<RequireAuth><RoomsPage /></RequireAuth>} />
      <Route path="/lobby" element={<RequireAuth><RequireRoom><LobbyPage /></RequireRoom></RequireAuth>} />
      <Route path="/call" element={<RequireAuth><RequireRoom><CallPage /></RequireRoom></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
