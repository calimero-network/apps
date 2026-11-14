import { render } from '@testing-library/react';
import { nodeShieldGate } from '@calimero-apps/passkey/testing';

import { APP, CalimeroProvider } from './calimero';

nodeShieldGate(APP, (deps) => render(<CalimeroProvider deps={deps}>{null}</CalimeroProvider>));
