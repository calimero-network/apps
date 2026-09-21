import { beforeAll, describe, expect, it } from 'vitest';
import { MeroJs } from '@calimero-network/mero-js';

import { meroApp } from '../../src/lib/meroApp';
import { setMeroInstance } from '../../src/lib/node';
import { DefaultContextService } from '../../src/api/defaultContextService';
import { ClientApiDataSource } from '../../src/api/dataSource/ClientApiDataSource';
import { toBlobIdHex } from '../../src/lib/blobIds';

// The reported chain, end to end:
//   Default context not found  ->  createSignature / listSignatures /
//   joinSharedContext all refuse.
// One cause: `ensureDefaultContext` could never succeed.

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
});

let mero: MeroJs;

beforeAll(async () => {
  mero = new MeroJs({ baseUrl: 'http://127.0.0.1:2428' });
  await mero.authenticate({ username: 'admin', password: 'calimero1234' });
  setMeroInstance(mero);
}, 120_000);

describe('ensureDefaultContext', () => {
  it('finds or creates the private context, and reports a usable identity', async () => {
    DefaultContextService.clearInstance();
    store.clear();
    const app = meroApp(mero, null);
    const svc = DefaultContextService.getInstance(app);

    const res = await svc.ensureDefaultContext();
    console.log('success =', res.success, ' error =', res.error ?? '-');
    console.log('contextId =', res.contextInfo?.contextId);
    console.log('identity  =', res.contextInfo?.memberPublicKey);
    expect(res.success).toBe(true);
    expect(res.contextInfo?.contextId).toMatch(/^[0-9a-f]{64}$/);
    expect(res.contextInfo?.memberPublicKey).toMatch(/^[0-9a-f]{64}$/);
  }, 180_000);

  it('a SECOND call finds the one that exists rather than making another', async () => {
    DefaultContextService.clearInstance();
    const app = meroApp(mero, null);
    const first =
      await DefaultContextService.getInstance(app).ensureDefaultContext();
    store.clear(); // forget the local record: force real discovery
    DefaultContextService.clearInstance();
    const second = await DefaultContextService.getInstance(
      meroApp(mero, null),
    ).ensureDefaultContext();
    console.log('first =', first.contextInfo?.contextId);
    console.log(
      'second=',
      second.contextInfo?.contextId,
      ' wasCreated =',
      second.wasCreated,
    );
    expect(second.success).toBe(true);
    expect(second.contextInfo?.contextId).toBe(first.contextInfo?.contextId);
    expect(second.wasCreated).toBe(false);
  }, 240_000);

  it('signatures now save and list, which is what the errors were about', async () => {
    DefaultContextService.clearInstance();
    store.clear();
    const app = meroApp(mero, null);
    const ensured =
      await DefaultContextService.getInstance(app).ensureDefaultContext();
    expect(ensured.success).toBe(true);
    const ctx = ensured.contextInfo!.contextId;

    const api = new ClientApiDataSource(app);
    const png = new File([new Uint8Array([137, 80, 78, 71])], 'sig.png', {
      type: 'image/png',
    });
    const up = await mero.admin.uploadBlob({ data: png, contextId: ctx });
    const created = await api.createSignature(
      'Signature 1',
      toBlobIdHex(up.blobId),
      png.size,
    );
    console.log('createSignature error =', created.error ?? '-');
    expect(created.error ?? null).toBeNull();

    const rows = await api.listSignatures();
    console.log('listSignatures error  =', rows.error ?? '-');
    expect(rows.error ?? null).toBeNull();
  }, 240_000);
});
