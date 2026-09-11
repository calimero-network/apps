import { Navigate, Route, Routes } from "react-router-dom";

import HomePage from "./pages/home";
import LandingPage from "./pages/landing/LandingPage";
import VaultDashboard from "./pages/vault/VaultDashboard";

/** Every path the shared landing page serves. See src/pages/landing. */
const LANDING_PATHS = ['/', '/docs', '/preview'];


// The provider tree lives in index.tsx so that MeroProvider is mounted before
// anything reads the session. This component is routing only.
export default function App() {
  return (
    <Routes>
      {/* The explainer is the front door; `Authenticate` keeps the
          ConnectButton and moves to /login. A desktop hand-off still lands on
          `/`, and LandingPage sends an authenticated visitor straight to
          /home — so the launcher path gains a redirect, not a stop. */}
      {/* The landing page is three pages: `/`, `/docs` and `/preview`. They are
          real URLs so they can be shared and opened cold, which needs a route
          here — otherwise this app's catch-all swallows the deep link before
          the page ever renders. */}
      {LANDING_PATHS.map((landingPath) => (
        <Route key={landingPath} path={landingPath} element={<LandingPage />} />
      ))}
      {/* The /login PAGE is gone — every app had one, every one looked
          different, and its whole content was a button the visitor had
          already pressed to get there. The path stays as a redirect so a
          bookmark lands on the front door instead of a blank route. */}
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/home" element={<HomePage />} />
      <Route path="/vault/:vaultId" element={<VaultDashboard />} />
    </Routes>
  );
}
