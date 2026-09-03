import { Routes, Route } from "react-router-dom";

import HomePage from "./pages/home";
import LandingPage from "./pages/landing/LandingPage";
import Authenticate from "./pages/login/Authenticate";
import VaultDashboard from "./pages/vault/VaultDashboard";

// The provider tree lives in index.tsx so that MeroProvider is mounted before
// anything reads the session. This component is routing only.
export default function App() {
  return (
    <Routes>
      {/* The explainer is the front door; `Authenticate` keeps the
          ConnectButton and moves to /login. A desktop hand-off still lands on
          `/`, and LandingPage sends an authenticated visitor straight to
          /home — so the launcher path gains a redirect, not a stop. */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<Authenticate />} />
      <Route path="/home" element={<HomePage />} />
      <Route path="/vault/:vaultId" element={<VaultDashboard />} />
    </Routes>
  );
}
