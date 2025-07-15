import React from 'react';
import { Routes, Route, BrowserRouter } from 'react-router-dom';
import { AccessTokenWrapper } from '@calimero-network/calimero-client';
import { ThemeProvider } from './contexts/ThemeContext';

import Dashboard from './pages/dashboard';
import SetupPage from './pages/setup';
import Authenticate from './pages/login/Authenticate';
import ContextPage from './pages/context';
import AgreementPage from './pages/agreement';
import SignaturesPage from './pages/signatures';

export default function App() {
  return (
    <ThemeProvider>
      <AccessTokenWrapper>
        <BrowserRouter basename="/mero-docs/">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/auth" element={<Authenticate />} />
            <Route path="/context" element={<ContextPage />} />
            <Route path="/agreement" element={<AgreementPage />} />
            <Route path="/signatures" element={<SignaturesPage />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </BrowserRouter>
      </AccessTokenWrapper>
    </ThemeProvider>
  );
}
