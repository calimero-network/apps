import React from 'react';
import { Routes, Route, BrowserRouter } from 'react-router-dom';

import CalendarPage from './pages/calendar';
import { LoginPage } from './pages/login';

export default function App() {
  return (
    <BrowserRouter basename="/plantr/">
      <Routes>
        <Route path="/" element={<CalendarPage />} />
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </BrowserRouter>
  );
}
