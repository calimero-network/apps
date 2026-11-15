import { render } from '@testing-library/react';
import { nodeShieldGate } from '@calimero-apps/passkey/testing';
import { beforeAll } from 'vitest';

import App from './App';
import { APP } from './calimero/session';

beforeAll(() => {
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const g = globalThis as Record<string, unknown>;
  g.IntersectionObserver ??= Observer;
  g.ResizeObserver ??= Observer;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as never;
});

nodeShieldGate(APP, (deps) => render(<App deps={deps} />));
