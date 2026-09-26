// Screenshot harness entry. Renders the REAL pages against fixture modules, so
// the images document the shipped UI rather than a re-implementation of it.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import LandingPage from '../../src/pages/landing/LandingPage';
import TeamsPage from '../../src/pages/teams/TeamsPage';
import TeamPage from '../../src/pages/team/TeamPage';
import VaultPage from '../../src/pages/vault/VaultPage';
import SecurityPage from '../../src/pages/security/SecurityPage';
import { applyTheme } from '../../src/lib/theme';
import { scenarioById } from './fixtures';
import '../../src/index.css';

const sc = scenarioById(
  new URLSearchParams(location.search).get('s') ?? 'teams',
);

applyTheme(sc.variant === 'light' ? 'light' : 'dark');

const initial =
  sc.page === 'team'
    ? `/teams/ns-1${sc.variant?.startsWith('people') ? '?tab=people' : ''}`
    : sc.page === 'vault'
      ? '/vault/ctx-1'
      : sc.page === 'security'
        ? '/security'
        : sc.page === 'landing'
          ? '/'
          : '/teams';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/teams/:teamId" element={<TeamPage />} />
        <Route path="/vault/:vaultId" element={<VaultPage />} />
        <Route path="/security" element={<SecurityPage />} />
      </Routes>
    </MemoryRouter>
  </StrictMode>,
);
