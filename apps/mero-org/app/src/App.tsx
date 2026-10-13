import { useMero } from "@calimero-network/mero-react";
import LandingPage from "./pages/landing/LandingPage";

export function App() {
  const { isAuthenticated, isLoading } = useMero();
  if (isLoading) return <div className="empty">Connecting…</div>;
  if (!isAuthenticated) return <LandingPage />;
  return <div className="empty">Signed in. Pages arrive in Task 7.</div>;
}
