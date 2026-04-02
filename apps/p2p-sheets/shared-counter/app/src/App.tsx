import { Routes, Route, BrowserRouter } from 'react-router-dom';
import { MeroProvider, AppMode } from '@calimero-network/mero-react';
import { ToastProvider } from '@calimero-network/mero-ui';

import HomePage from './pages/home';
import Authenticate from './pages/login/Authenticate';

export default function App() {
  return (
    <MeroProvider
      mode={AppMode.SingleContext}
      packageName={import.meta.env.VITE_PACKAGE_NAME || 'com.calimero.shared-counter'}
    >
      <ToastProvider>
        <BrowserRouter basename="/">
          <Routes>
            <Route path="/" element={<Authenticate />} />
            <Route path="/home" element={<HomePage />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </MeroProvider>
  );
}
