import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateDeviceKey } from '@calimero-network/mero-pass';

// ── The lock screen's first-run setup ───────────────────────────────────────
//
// A browser may not use Mero Pass with an unprotected key, or without a
// recovery key: the gate shows nothing else until both are done. This drives
// the real gate and the real DeviceKeeper over an in-memory store; only the
// node walks (moving vault keys, making the recovery key in every vault) are
// stubbed.

const store = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock('../lib/deviceKey', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/deviceKey')>();
  const memory = {
    async get() {
      return store.value as never;
    },
    async put(v: unknown) {
      store.value = v;
    },
    async clear() {
      store.value = undefined;
    },
  };
  return { ...actual, deviceKeeper: new actual.DeviceKeeper(memory) };
});

const setup = vi.hoisted(() => ({
  moved: 0,
  restored: [] as string[],
}));

vi.mock('../hooks/useDeviceSetup', async () => {
  const { deviceKeeper } = await import('../lib/deviceKey');
  return {
    useDeviceSetup: () => ({
      ready: true,
      async protect(_how: string, passphrase: string) {
        const hadKey = deviceKeeper.isUnlocked;
        await deviceKeeper.setPassphrase(passphrase, async () => {
          if (hadKey) setup.moved += 1;
        });
        return setup.moved;
      },
      async createRecovery() {
        return { code: 'AAAA-BBBB-CCCD', vaults: 0 };
      },
      async restoreRecovery(code: string) {
        setup.restored.push(code);
        return 1;
      },
    }),
  };
});

const { default: LockGate } = await import('./LockGate');
const { deviceKeeper } = await import('../lib/deviceKey');

function gate() {
  return render(
    <LockGate>
      <p data-testid="inside">vault</p>
    </LockGate>,
  );
}

async function protectWith(passphrase: string) {
  fireEvent.change(await screen.findByTestId('setup-passphrase'), {
    target: { value: passphrase },
  });
  fireEvent.change(screen.getByTestId('setup-passphrase-repeat'), {
    target: { value: passphrase },
  });
  fireEvent.click(screen.getByTestId('setup-use-passphrase'));
}

describe('LockGate', () => {
  beforeEach(() => {
    store.value = undefined;
    setup.moved = 0;
    setup.restored = [];
    deviceKeeper.lock();
    localStorage.clear();
  });

  it('makes a new browser protect its first key, then save a recovery key', async () => {
    gate();
    expect(await screen.findByTestId('device-setup')).toBeInTheDocument();
    expect(screen.queryByTestId('inside')).toBeNull();

    await protectWith('correct horse');
    expect(
      await screen.findByTestId('recovery-setup', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(await deviceKeeper.protection()).toBe('passphrase');
    expect(setup.moved).toBe(0);

    fireEvent.click(screen.getByTestId('setup-create-recovery'));
    expect(await screen.findByTestId('setup-recovery-code')).toHaveTextContent(
      'AAAA-BBBB-CCCD',
    );
    const done = screen.getByTestId('setup-recovery-done');
    expect(done).toBeDisabled();
    fireEvent.change(screen.getByTestId('setup-recovery-confirm'), {
      target: { value: 'cccd' },
    });
    expect(done).toBeEnabled();
    fireEvent.click(done);
    expect(await screen.findByTestId('inside')).toBeInTheDocument();
  }, 20_000);

  it('makes an unprotected key from before protect itself, moving its vaults', async () => {
    const pair = await generateDeviceKey();
    store.value = {
      kind: 'plain',
      privateKey: pair.privateKey,
      publicRaw: pair.publicRaw,
      createdAt: 0,
    };
    localStorage.setItem(
      'mero-pass:recovery-key',
      JSON.stringify({ fingerprint: 'ef', publicKey: '' }),
    );
    gate();
    expect(await screen.findByTestId('device-setup')).toHaveTextContent(
      'stored unprotected',
    );
    expect(screen.queryByTestId('inside')).toBeNull();

    await protectWith('correct horse');
    expect(
      await screen.findByTestId('inside', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(setup.moved).toBe(1);
    expect(await deviceKeeper.protection()).toBe('passphrase');
  }, 20_000);

  it('takes a recovery code made in another browser instead of a new one', async () => {
    await deviceKeeper.setPassphrase('correct horse', async () => {});
    gate();
    fireEvent.change(await screen.findByTestId('setup-restore-code'), {
      target: { value: 'ZZZZ-YYYY' },
    });
    fireEvent.click(screen.getByTestId('setup-restore'));
    expect(await screen.findByTestId('inside')).toBeInTheDocument();
    expect(setup.restored).toEqual(['ZZZZ-YYYY']);
  }, 20_000);

  it('asks a protected, set-up browser only for its passphrase', async () => {
    await deviceKeeper.setPassphrase('correct horse', async () => {});
    deviceKeeper.lock();
    localStorage.setItem(
      'mero-pass:recovery-key',
      JSON.stringify({ fingerprint: 'ef', publicKey: '' }),
    );
    gate();
    fireEvent.change(await screen.findByTestId('unlock-passphrase'), {
      target: { value: 'correct horse' },
    });
    fireEvent.click(screen.getByTestId('unlock'));
    await waitFor(
      () => expect(screen.getByTestId('inside')).toBeInTheDocument(),
      { timeout: 10_000 },
    );
  }, 20_000);
});
