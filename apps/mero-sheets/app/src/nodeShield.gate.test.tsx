// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { nodeShieldGate } from '@calimero-apps/passkey/testing';
import { vi } from 'vitest';

import App from './App';
import { APP } from './session';

// The recalc engine is a wasm module the screens do without until it is ready.
vi.mock('./engine/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./engine/engine')>()),
  initEngine: () => new Promise<void>(() => {}),
}));

nodeShieldGate(APP, (deps) => render(<App deps={deps} />));
