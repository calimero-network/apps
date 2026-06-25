import { type ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { IS_TAURI } from "./lib/tauri";
import LandingPage from "./pages/LandingPage";
import LobbyPage from "./pages/LobbyPage";
import CallPage from "./pages/CallPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useMero();
  if (isLoading) return null; // wait for the auth probe; avoids a flash
  if (!isAuthenticated) return <LandingPage />;
  return <>{children}</>;
}

export default function App() {
  // Web is blocked: Mero Meet needs the desktop app's node + SSO + media bridge.
  // Outside Tauri we only ever render the landing page.
  if (!IS_TAURI) return <LandingPage />;

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/lobby" replace />} />
      <Route path="/lobby" element={<RequireAuth><LobbyPage /></RequireAuth>} />
      <Route path="/call" element={<RequireAuth><CallPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/lobby" replace />} />
    </Routes>
  );
}
