import { beforeAll, describe, expect, it } from 'vitest';
import { MeroJs } from '@calimero-network/mero-js';

import { meroApp } from '../../src/lib/meroApp';
import { adminApi, setMeroInstance } from '../../src/lib/node';
import { DefaultContextService } from '../../src/api/defaultContextService';
import { ClientApiDataSource } from '../../src/api/dataSource/ClientApiDataSource';
import { appsFromResponse, pickApplicationId } from '../../src/lib/appId';
import { nodeApi } from '../../src/lib/node';
import { createAgreement, createWorkspace } from '../../src/lib/agreements';
import { isHexId } from '../../src/lib/participants';

// ── The whole contract surface, against a REAL node ─────────────────────────
//
// ⚠️ WHY THIS EXISTS AND WHY `ClientApiDataSource.test.ts` IS NOT ENOUGH.
//
// The unit tests assert the argument object this app BUILDS. They cannot see
// the node reject it — and three of the four defects this file's subject was
// rewritten to remove were rejections, not logic errors:
//
//   * `leave_shared_context` was sent `{context_id}`; the ABI says
//     `context_id_str`, every body is `deny_unknown_fields`, and the call had
//     therefore answered 400 for its entire life
//   * ids were base58 where the contract parses hex
//   * optional arguments went as `undefined`, which `JSON.stringify` drops,
//     so the contract saw MISSING fields
//
// A mock agrees with whatever this repo believes. Only a node disagrees.
//
//   pnpm test:live   (see workspaces.live.test.ts for the node setup)

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
const PASSWORD = process.env.MERO_LIVE_PASSWORD ?? 'signtestpw123';

let mero: MeroJs;
let api: ClientApiDataSource;
let agreementId = '';
let memberPublicKey = '';

beforeAll(async () => {
  mero = new MeroJs({ baseUrl: BASE });
  await mero.authenticate({ username: USER, password: PASSWORD });
  setMeroInstance(mero);

  const app = meroApp(mero, null);
  const ensured =
    await DefaultContextService.getInstance(app).ensureDefaultContext();
  expect(ensured.success, ensured.error ?? '').toBe(true);
  api = new ClientApiDataSource(app);

  const applicationId = pickApplicationId(
    appsFromResponse((await nodeApi(mero).getInstalledApplications()).data),
  );
  expect(applicationId, 'mero-sign is not installed on this node').toBeTruthy();

  const workspace = await createWorkspace(adminApi(), {
    applicationId,
    name: `Surface ${Date.now()}`,
  });
  const agreement = await createAgreement(adminApi(), {
    applicationId,
    namespaceId: workspace.namespaceId,
    name: `Agreement ${Date.now()}`,
  });
  agreementId = agreement.contextId;
  memberPublicKey = agreement.memberPublicKey;
}, 240_000);

describe('the refactored surface, against a real node', () => {
  it('reads an agreement back with HEX ids', async () => {
    const res = await api.getContextDetails(agreementId, agreementId);

    expect(res.error ?? null).toBeNull();
    const details = res.data!;
    // ⚠️ THE REGRESSION, on the wire. `bs58.encode` here produced ids the
    // contract's own `parse_public_key_hex` refuses — and they were rendered
    // into the roster and copied out of it by hand.
    expect(isHexId(details.context_id)).toBe(true);
    expect(isHexId(details.owner)).toBe(true);
    for (const p of details.participants) expect(isHexId(p.user_id)).toBe(true);
  }, 240_000);

  it('whoami answers a hex ACCOUNT that appears in the roster', async () => {
    const me = await api.whoami(agreementId);
    expect(me.error ?? null).toBeNull();
    expect(isHexId(me.data!)).toBe(true);

    // The point of `whoami` existing: the app's stored member key is a DEVICE
    // key, and since rc.27 both are 64 hex, so the wrong one matches nothing
    // while type-checking perfectly. The roster is keyed by ACCOUNT.
    const details = await api.getContextDetails(agreementId, agreementId);
    const roster = (details.data?.participants ?? []).map((p) => p.user_id);
    expect(roster).toContain(me.data);
  }, 240_000);

  it('lists documents in an agreement that has none', async () => {
    const res = await api.listDocuments(agreementId, agreementId);
    expect(res.error ?? null).toBeNull();
    expect(res.data).toEqual([]);
  }, 240_000);

  it('uploads a document with its optional arguments ABSENT', async () => {
    // ⚠️ The three optional arguments are omitted here ON PURPOSE. They used
    // to be forwarded as `undefined`, which `JSON.stringify` drops, so the
    // contract saw three missing fields rather than three nulls. This is the
    // call that exercises that.
    const pdf = new File([new Uint8Array([37, 80, 68, 70])], 'a.pdf', {
      type: 'application/pdf',
    });
    const up = await mero.admin.uploadBlob({
      data: pdf,
      contextId: agreementId,
    });

    const created = await api.uploadDocument(
      agreementId,
      'Lease.pdf',
      'hash-1',
      String(up.blobId),
      pdf.size,
    );
    expect(created.error ?? null).toBeNull();
    expect(typeof created.data).toBe('string');

    const listed = await api.listDocuments(agreementId, agreementId);
    const row = (listed.data ?? []).find((d) => d.name === 'Lease.pdf');
    expect(row, 'the uploaded document did not come back').toBeTruthy();
    // Hex, because this id is what `GET /admin-api/blobs/:id` is called with.
    expect(isHexId(row!.pdf_blob_id)).toBe(true);
    const bytes = await mero.admin.getBlob(row!.pdf_blob_id, {
      contextId: agreementId,
    });
    expect(new Uint8Array(bytes).length).toBe(4);

    const gone = await api.deleteDocument(row!.id, agreementId);
    expect(gone.error ?? null).toBeNull();
  }, 240_000);

  it('records and then LEAVES a shared agreement — the call that had never worked', async () => {
    // ⚠️ THE REGRESSION THIS WHOLE FILE IS FOR. The argument was `context_id`;
    // the ABI says `context_id_str`. Core bodies are `deny_unknown_fields`, so
    // this answered 400 every time it was called, for its entire life — and
    // its only caller is commented out, which is why it was never reported.
    //
    // The round trip is the assertion: leaving something this node never
    // recorded is REFUSED by the contract, which is correct and is not what
    // the bug was. Joining first and then leaving is the path a person takes,
    // and it is the one that could never have reached the contract at all.
    const notJoined = await api.leaveSharedContext(agreementId);
    expect(
      notJoined.error,
      'leaving an unrecorded agreement should be refused',
    ).toBeTruthy();

    const joined = await api.joinSharedContext(
      agreementId,
      memberPublicKey,
      'Agreement under test',
    );
    expect(joined.error ?? null).toBeNull();

    const left = await api.leaveSharedContext(agreementId);
    // Named individually: a `deny_unknown_fields` refusal is the specific
    // failure this test exists to catch, and it reads very differently from
    // the contract declining for a reason of its own.
    expect(left.error?.message ?? '').not.toMatch(/unknown field/i);
    expect(left.error?.message ?? '').not.toMatch(/missing field/i);
    expect(left.error ?? null).toBeNull();
  }, 240_000);
});
