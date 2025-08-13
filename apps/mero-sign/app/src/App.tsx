import React, { useState } from 'react';
import { Routes, Route, BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from './contexts/ThemeContext';
import { IcpAuthProvider } from './contexts/IcpAuthContext';
import Dashboard from './pages/dashboard';
import AgreementPage from './pages/agreement';
import SignaturesPage from './pages/signatures';
import { MobileLayout } from './components/MobileLayout';
import { CalimeroConnectionRequired } from './components/CalimeroConnectionRequired';
import { useCalimero } from '@calimero-network/calimero-client';

export default function App() {
  const { isAuthenticated } = useCalimero();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <IcpAuthProvider>
      <ThemeProvider>
        <BrowserRouter basename="/mero-docs/">
          <MobileLayout
            sidebarOpen={sidebarOpen}
            onSidebarToggle={setSidebarOpen}
          >
            {isAuthenticated ? (
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/agreement" element={<AgreementPage />} />
                <Route path="/signatures" element={<SignaturesPage />} />
                <Route path="*" element={<Dashboard />} />
              </Routes>
            ) : (
              <CalimeroConnectionRequired
                onOpenSidebar={() => setSidebarOpen(true)}
              />
            )}
          </MobileLayout>
        </BrowserRouter>
      </ThemeProvider>
    </IcpAuthProvider>
  );
}
