import React, { useState } from 'react';
import { Routes, Route, BrowserRouter } from 'react-router-dom';
import { CalimeroProvider, AppMode } from '@calimero-network/calimero-client';
import { ToastProvider } from '@calimero-network/mero-ui';

import HomePage from './pages/home';
import Authenticate from './pages/login/Authenticate';
import VaultDashboard from './pages/vault/VaultDashboard';

export default function App() {
  const [clientAppId] = useState<string>(
    '4WEikdan9yeaDTADsS1uGzGasiVuJDQcozJbogEyTYcy',
  );

  return (
    <CalimeroProvider
      clientApplicationId={clientAppId}
      applicationPath={window.location.pathname || '/'}
      mode={AppMode.MultiContext}
    >
      <ToastProvider>
        <BrowserRouter basename="/">
          <Routes>
            <Route path="/" element={<Authenticate />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/vault/:vaultId" element={<VaultDashboard />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </CalimeroProvider>
  );
}
