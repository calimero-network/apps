import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Home from "./pages/Home";
import { getAuthConfig, useCalimero } from "@calimero-network/calimero-client";
import { useEffect, useState } from "react";
import Context from "./pages/Context";
import { LoadingSpinner } from "./components/LoadingSpinner";

function App() {
  const { isAuthenticated } = useCalimero();
  const authConfig = getAuthConfig();
  const [isConfigSet, setIsConfigSet] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      const hasRequiredConfig =
        authConfig?.appEndpointKey &&
        authConfig?.contextId &&
        authConfig?.executorPublicKey &&
        authConfig?.jwtToken;

      setIsConfigSet(Boolean(hasRequiredConfig));
      setIsLoading(false);
    }, 100);

    return () => clearTimeout(timer);
  }, [authConfig, isAuthenticated]);

  return (
    <Routes>
      <Route
        path="/login"
        element={
          isAuthenticated && isConfigSet ? (
            <Navigate to="/" replace />
          ) : (
            <Login
              isAuthenticated={isAuthenticated}
              isConfigSet={isConfigSet}
            />
          )
        }
      />
      <Route
        path="/"
        element={
          isLoading ? (
            <LoadingSpinner />
          ) : isAuthenticated && isConfigSet ? (
            <Home isConfigSet={isConfigSet} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/context"
        element={
          isLoading ? (
            <LoadingSpinner />
          ) : isAuthenticated && isConfigSet ? (
            <Context />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
