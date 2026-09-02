import { Routes, Route } from "react-router-dom";

import HomePage from "./pages/home";
import Authenticate from "./pages/login/Authenticate";
import VaultDashboard from "./pages/vault/VaultDashboard";

// The provider tree lives in index.tsx so that MeroProvider is mounted before
// anything reads the session. This component is routing only.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Authenticate />} />
      <Route path="/home" element={<HomePage />} />
      <Route path="/vault/:vaultId" element={<VaultDashboard />} />
    </Routes>
  );
}
