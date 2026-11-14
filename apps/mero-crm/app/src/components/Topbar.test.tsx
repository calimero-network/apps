import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CalimeroClient } from '@calimero-network/mero-js';
import { bindNodeShield } from '@calimero-apps/passkey/nodeShield';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AppThemeProvider } from '../theme';
import Topbar from './Topbar';

const VERIFIED = { status: 'verified', url: 'https://node-1.example.net', mock: false, release: '2.3.148', profile: 'locked-read-only', checkedAt: 1 };
const client = {
  nodeUrl: VERIFIED.url,
  verification: () => VERIFIED,
  verify: async () => VERIFIED,
} as unknown as CalimeroClient;

let unbind: () => void;
beforeEach(() => {
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  unbind = bindNodeShield(client, 'Test cluster');
});
afterEach(() => {
  cleanup();
  unbind();
});

it('places the node shield in the header, once, in place of the floating one', () => {
  render(
    <MemoryRouter initialEntries={['/crm']}>
      <AppThemeProvider>
        <Topbar
          onNewDeal={vi.fn()}
          pipelineName="New business"
          ownerFilter=""
          ownerOptions={[]}
          myName="Alice"
          onOwnerFilterChange={vi.fn()}
          searchQuery=""
          onSearchChange={vi.fn()}
          searchInputRef={{ current: null }}
        />
      </AppThemeProvider>
    </MemoryRouter>,
  );
  expect(within(screen.getByRole('banner')).getAllByTestId('node-shield')).toHaveLength(1);
  expect(screen.getAllByTestId('node-shield')).toHaveLength(1);
});
