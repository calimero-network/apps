// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { nodeShieldGate } from '@calimero-apps/passkey/testing';

import { APP, useSession } from './session';

nodeShieldGate(APP, (deps) => renderHook(() => useSession(deps)));
