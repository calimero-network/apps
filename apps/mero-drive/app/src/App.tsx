// v9 app-side scaffold. Minimal routing + auth gate — the folder/docs
// UI will be rebuilt against the new generated clients + mero-react
// hooks in Phases 5-8 of the namespace-migration plan.
//
// For now:
//   /               → landing page
//   /login          → Authenticate (node-URL + SSO flow)
//   /app/*          → placeholder workspace page (logged-in only)
//   *               → redirect to /

import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useCalimero } from '@calimero-network/calimero-client';

const LandingPage = lazy(() => import('./pages/landing'));
const Authenticate = lazy(() => import('./pages/login/Authenticate'));

function WorkspacePlaceholder() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <div className="max-w-md text-center space-y-4 p-8">
        <h1 className="text-2xl font-semibold">Mero Drive v9</h1>
        <p className="text-sm text-muted-foreground">
          You're authenticated against the v9 namespace backend. The
          folder + document UI is being rebuilt against the new
          registry / docs services and will land in follow-up PRs.
        </p>
      </div>
    </div>
  );
}

function AuthedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useCalimero();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}



const App: React.FC = () => {
  const { isAuthenticated, app } = useCalimero();
  // `app` is populated once an application id resolves against the
  // CalimeroProvider's packageName+registryUrl. We treat that as the
  // "config is set" signal the Authenticate page uses to decide between
  // its three states (landing CTA, node-URL form, authenticated redirect).
  const isConfigSet = Boolean(app);

  return (
    <Suspense fallback={<div />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route
          path="/login"
          element={
            <Authenticate isAuthenticated={isAuthenticated} isConfigSet={isConfigSet} />
          }
        />
        <Route
          path="/app/*"
          element={
            <AuthedRoute>
              <WorkspacePlaceholder />
            </AuthedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
};

export default App;
