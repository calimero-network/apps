import { beforeAll, describe, expect, it } from 'vitest';
import { MeroJs } from '@calimero-network/mero-js';

import {
  createAgreement,
  createWorkspace,
  createPersonalContext,
  ensurePersonalWorkspace,
} from '../../src/lib/agreements';
import { toBlobIdHex } from '../../src/lib/blobIds';
import { nodeApi, setMeroInstance } from '../../src/lib/node';
import { appsFromResponse, pickApplicationId } from '../../src/lib/appId';
import { DocumentService } from '../../src/api/documentService';
import { ClientApiDataSource } from '../../src/api/dataSource/ClientApiDataSource';
import { meroApp } from '../../src/lib/meroApp';

// ── The three things that were reported broken, end to end ─────────────────
//
// Not the blob-id primitive (that is in `workspaces.live.test.ts`) — the
// actual app paths: upload a document through `DocumentService`, save a
// signature through `ClientApiDataSource`, and read both back. These are the
// paths that produced "upload does not work i get just server error" and "it
// saves to blob but its not displayed anywhere".

// ⚠️ The data layer reads the "default context" out of `localStorage`, which
// node does not have. Stubbed rather than worked around in the app: that
// storage IS the app's session in a browser, and a live check that bypassed
// it would be exercising a path the app never takes.
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
});

const BASE = process.env.MERO_LIVE_URL ?? 'http://127.0.0.1:2428';
const USER = process.env.MERO_LIVE_USER ?? 'admin';
const PASSWORD = process.env.MERO_LIVE_PASSWORD ?? 'calimero1234';

let mero: MeroJs;
let applicationId = '';
let agreementContext = '';
let privateContext = '';

beforeAll(async () => {
  mero = new MeroJs({
    baseUrl: BASE,
    credentials: { username: USER, password: PASSWORD },
  });
  await mero.authenticate({ username: USER, password: PASSWORD });
  // The module-level clients the services import at module scope.
  setMeroInstance(mero);

  const apps = await nodeApi(mero).getInstalledApplications();
  applicationId = pickApplicationId(appsFromResponse(apps.data));

  const { namespaceId } = await createWorkspace(mero.admin, {
    applicationId,
    name: 'Docs live',
    accountId: (await mero.admin.getNodeIdentity()).accountId,
  });
  const agreement = await createAgreement(mero.admin, {
    applicationId,
    namespaceId,
    name: 'Live NDA',
  });
  agreementContext = agreement.contextId;

  const personalNs = await ensurePersonalWorkspace(mero.admin, applicationId);
  privateContext = (
    await createPersonalContext(mero.admin, {
      applicationId,
      namespaceId: personalNs,
      name: 'default',
    })
  ).contextId;

  // What `useDefaultContext` records in a browser once the private context
  // exists. `ClientApiDataSource` reads it for every signature call.
  const identity = await mero.admin.getContextIdentitiesOwned(privateContext);
  store.set('defaultContextId', privateContext);
  store.set('defaultContextUserID', identity.identities[0] ?? '');
  store.set(
    'defaultContext',
    JSON.stringify({
      contextId: privateContext,
      memberPublicKey: identity.identities[0] ?? '',
      executorId: identity.identities[0] ?? '',
      applicationId,
      context_name: 'default',
      is_private: true,
    }),
  );
}, 180_000);

describe('uploading a document', () => {
  it('stores it and lists it back with a READABLE blob id', async () => {
    const file = new File(
      [new Uint8Array([37, 80, 68, 70, 1, 2, 3])],
      'nda.pdf',
      {
        type: 'application/pdf',
      },
    );
    const res = await new DocumentService().uploadDocument(
      agreementContext,
      'nda.pdf',
      file,
    );
    expect(res.error ?? null).toBeNull();

    const listed = await new DocumentService().listDocuments(agreementContext);
    expect(listed.error ?? null).toBeNull();
    const doc = (listed.data ?? []).find((d) => d.name === 'nda.pdf');
    expect(doc, 'the uploaded document is not in the list').toBeTruthy();

    // ⚠️ THE ASSERTION THAT WOULD HAVE FAILED BEFORE. The id recorded in the
    // contract has to be one the node will decode.
    expect(doc!.pdfBlobId).toMatch(/^[0-9a-f]{64}$/);
    const bytes = await mero.admin.getBlob(doc!.pdfBlobId, {
      contextId: agreementContext,
    });
    expect(new Uint8Array(bytes).length).toBe(7);
  }, 180_000);
});

describe('saving a drawn signature', () => {
  it('round-trips: the image comes back, which is what never happened', async () => {
    const app = meroApp(mero, null);
    const api = new ClientApiDataSource(app);

    const png = new File(
      [new Uint8Array([137, 80, 78, 71, 13, 10])],
      'sig.png',
      {
        type: 'image/png',
      },
    );
    const up = await mero.admin.uploadBlob({
      data: png,
      contextId: privateContext,
    });
    const blobId = toBlobIdHex(up.blobId);
    expect(blobId).toMatch(/^[0-9a-f]{64}$/);

    const created = await api.createSignature('Signature 1', blobId, png.size);
    expect(created.error ?? null).toBeNull();

    const rows = await api.listSignatures();
    const data = rows.data as unknown;
    const list = (
      Array.isArray(data) ? data : (data as { output?: unknown })?.output ?? []
    ) as { blob_id: string | number[] }[];
    expect(list.length).toBeGreaterThan(0);

    // The read path the library uses. Before the fix this produced base58 and
    // the fetch below threw, into a catch that showed a blank card.
    const readBack = toBlobIdHex(list[0].blob_id);
    expect(readBack).toBe(blobId);
    const bytes = await mero.admin.getBlob(readBack, {
      contextId: privateContext,
    });
    expect(new Uint8Array(bytes).length).toBe(6);
  }, 180_000);
});
