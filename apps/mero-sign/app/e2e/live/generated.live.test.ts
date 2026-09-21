import { beforeAll, describe, expect, it } from 'vitest';
import { MeroJs } from '@calimero-network/mero-js';

import { meroApp } from '../../src/lib/meroApp';
import { setMeroInstance } from '../../src/lib/node';
import { DefaultContextService } from '../../src/api/defaultContextService';
import { ClientApiDataSource } from '../../src/api/dataSource/ClientApiDataSource';
import { toBlobIdHex } from '../../src/lib/blobIds';

// The signature surface, now through `generated/MeroSignClient`.
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
let api: ClientApiDataSource;
let ctx = '';

beforeAll(async () => {
  mero = new MeroJs({ baseUrl: 'http://127.0.0.1:2428' });
  await mero.authenticate({ username: 'admin', password: 'calimero1234' });
  setMeroInstance(mero);
  const app = meroApp(mero, null);
  const ensured =
    await DefaultContextService.getInstance(app).ensureDefaultContext();
  expect(ensured.success, ensured.error ?? '').toBe(true);
  ctx = ensured.contextInfo!.contextId;
  api = new ClientApiDataSource(app);
}, 240_000);

describe('the generated client, against a real node', () => {
  it('creates, lists and deletes a signature — typed, no envelope', async () => {
    const png = new File([new Uint8Array([137, 80, 78, 71])], 'sig.png', {
      type: 'image/png',
    });
    const up = await mero.admin.uploadBlob({ data: png, contextId: ctx });

    const created = await api.createSignature(
      'Sig A',
      toBlobIdHex(up.blobId),
      png.size,
    );
    expect(created.error ?? null).toBeNull();
    expect(typeof created.data).toBe('number');

    const listed = await api.listSignatures();
    expect(listed.error ?? null).toBeNull();
    const rows = listed.data ?? [];
    expect(rows.length).toBeGreaterThan(0);

    const mine = rows.find((r) => r.name === 'Sig A')!;
    expect(mine).toBeTruthy();
    // ⚠️ BYTES, per the ABI — and they round-trip to the hex the blob is
    // stored under. The hand-written type said `string`, which is the bug.
    const hex =
      typeof mine.blob_id === 'string'
        ? mine.blob_id
        : toBlobIdHex(mine.blob_id.toArray());
    expect(hex).toBe(toBlobIdHex(up.blobId));
    const bytes = await mero.admin.getBlob(hex, { contextId: ctx });
    expect(new Uint8Array(bytes).length).toBe(4);

    const gone = await api.deleteSignature(Number(mine.id));
    expect(gone.error ?? null).toBeNull();
  }, 240_000);
});
