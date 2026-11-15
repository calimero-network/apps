import { render } from '@testing-library/react';
import { nodeShieldGate } from '@calimero-apps/passkey/testing';
import { MemoryRouter } from 'react-router-dom';

import App from './App';
import { APP, CalimeroProvider } from './calimero';

nodeShieldGate(APP, (deps) =>
  render(
    <CalimeroProvider deps={deps}>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </CalimeroProvider>,
  ),
);
