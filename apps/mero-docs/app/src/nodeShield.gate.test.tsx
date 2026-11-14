import { render } from '@testing-library/react';
import { nodeShieldGate } from '@calimero-apps/passkey/testing';

import { APP, SessionProvider } from './calimero/session';

nodeShieldGate(APP, (deps) => render(<SessionProvider deps={deps}>{null}</SessionProvider>));
