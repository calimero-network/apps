import React from 'react';
import { Routes, Route, BrowserRouter } from 'react-router-dom';
import { AccessTokenWrapper } from '@calimero-network/calimero-client';

import CalendarPage from './pages/calendar';
import AuthWrapper from './components/common/auth/AuthWrapper';
import { LoginPage } from './pages/login';

export default function App() {
  return (
    <AccessTokenWrapper>
      <BrowserRouter basename="/plantr/">
        <Routes>
          <Route
            path="/"
            element={
              <AuthWrapper>
                <CalendarPage />
              </AuthWrapper>
            }
          />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </BrowserRouter>
    </AccessTokenWrapper>
  );
}
