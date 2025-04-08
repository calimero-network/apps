import React from 'react';
import { Routes, Route, BrowserRouter } from 'react-router-dom';
import { AccessTokenWrapper } from '@calimero-network/calimero-client';

import CalendarPage from './pages/calendar';
import SetupPage from './pages/setup';
import LoginPage from './pages/login';
import ContextPage from './pages/context';

export default function App() {
  return (
    <AccessTokenWrapper>
      <BrowserRouter basename="/plantr/">
        <Routes>
          <Route path="/" element={<CalendarPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/context" element={<ContextPage />} />
        </Routes>
      </BrowserRouter>
    </AccessTokenWrapper>
  );
}
