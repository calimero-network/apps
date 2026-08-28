import { type ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import LandingPage from "./pages/landing/LandingPage";
import { LoginPage } from "./pages/login";
import TeamsPage from "./pages/teams/TeamsPage";
import CalendarPage from "./pages/calendar";
import { ToastProvider } from "./contexts/ToastContext";

// Route guards driven by mero-react auth state. `isLoading` gates the redirect
// so we don't flash to /login while the auth probe is still in flight.
function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useMero();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useMero();
  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to="/teams" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route
          path="/login"
          element={
            <RedirectIfAuthed>
              <LoginPage />
            </RedirectIfAuthed>
          }
        />
        <Route
          path="/teams"
          element={
            <RequireAuth>
              <TeamsPage />
            </RequireAuth>
          }
        />
        {/* The shared calendar for a context. teamId carried for "back to team". */}
        <Route
          path="/teams/:teamId/calendar/:contextId"
          element={
            <RequireAuth>
              <CalendarPage />
            </RequireAuth>
          }
        />
      </Routes>
    </ToastProvider>
  );
}
