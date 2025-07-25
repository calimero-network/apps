import React from 'react';
import { Routes, Route, BrowserRouter } from 'react-router-dom';
import { ProtectedRoutesWrapper } from '@calimero-network/calimero-client';
import { ThemeProvider } from './contexts/ThemeContext';
import { IcpAuthProvider } from './contexts/IcpAuthContext';
import Dashboard from './pages/dashboard';

import AgreementPage from './pages/agreement';
import SignaturesPage from './pages/signatures';

export default function App() {
  return (
    <IcpAuthProvider>
      <ThemeProvider>
        <BrowserRouter basename="/mero-docs/">
          <ProtectedRoutesWrapper permissions={['admin']}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/agreement" element={<AgreementPage />} />
              <Route path="/signatures" element={<SignaturesPage />} />
              <Route path="*" element={<Dashboard />} />
            </Routes>
          </ProtectedRoutesWrapper>
        </BrowserRouter>
      </ThemeProvider>
    </IcpAuthProvider>
  );
}
