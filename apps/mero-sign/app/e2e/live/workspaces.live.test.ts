import { describe, expect, it, beforeAll } from 'vitest';
import { MeroJs } from '@calimero-network/mero-js';

import {
  createAgreement,
  createPersonalContext,
  createWorkspace,
  ensurePersonalWorkspace,
  enterAgreement,
  listAgreements,
  listWorkspaces,
} from '../../src/lib/agreements';
import { nodeApi } from '../../src/lib/node';
import { appsFromResponse, pickApplicationId } from '../../src/lib/appId';

// ── The workspace model, against a REAL node ────────────────────────────────
//
// ⚠️ WHY THIS EXISTS, AND WHY THE UNIT TESTS ARE NOT ENOUGH.
//
// Every core request body is `#[serde(deny_unknown_fields)]`, and several are
// closed sets that changed across releases. A test with a fake `admin` asserts
// what THIS repo believes the body is; it cannot see the node reject it. That
// gap is exactly how the branch this builds on shipped a namespace join that
// posted the bare `SignedGroupOpenInvitation` instead of `{invitation}` — a
// real rc.41 node answers
//
//     400  Invalid JSON data: … invitation: missing field `invitation`
//
// and 161 green unit tests had nothing to say about it.
//
// ── Running it ──────────────────────────────────────────────────────────────
//
//   merod --home <dir> --node sign init --server-port 2731 --swarm-port 2831 \
//     --auth-mode embedded --auth-storage persistent \
//     --admin-user admin --admin-password-file <pwfile>
//   merod --home <dir> --node sign run &
//   (cd ../logic && cargo mero bundle --dev)
//   curl -X POST localhost:2731/admin-api/install-dev-application \
//     -H "authorization: Bearer <token>" -H 'content-type: application/json' \
//     -d '{"path":"<repo>/dist/com.calimero.mero-sign-0.1.0.mpk"}'
//   pnpm test:live
//
// NOT part of `pnpm test`: `vitest.config.ts` includes `src/**/*.test.ts`
// only, so CI never picks this up and a machine with no node never fails on
// it. It has its own config next to it.
//
// Override the node and credentials with MERO_LIVE_URL / MERO_LIVE_USER /
// MERO_LIVE_PASSWORD.

const BASE = process.env.MERO_LIVE_URL ?? 'http://127.0.0.1:2731';
const USER = process.env.MERO_LIVE_USER ?? 'admin';
const PASSWORD = process.env.MERO_LIVE_PASSWORD ?? 'signtestpw123';
let mero: MeroJs;
let applicationId = '';
let accountId = '';

beforeAll(async () => {
  mero = new MeroJs({
    baseUrl: BASE,
    credentials: { username: USER, password: PASSWORD },
  });
  // ⚠️ The constructor's `credentials` do NOT authenticate — they are only
  // held for later. Without this call every admin request is a 401, and
  // `nodeApi` wraps that into `{error}` rather than throwing, so the first
  // visible symptom is an empty application id much further down.
  await mero.authenticate({ username: USER, password: PASSWORD });
  const apps = await nodeApi(mero).getInstalledApplications();
  applicationId = pickApplicationId(appsFromResponse(apps.data));
  const id = await mero.admin.getNodeIdentity();
  accountId = id.accountId;
}, 60_000);

describe('the workspace model, on a real rc.41 node', () => {
  it('resolves this app by package, from the node', () => {
    expect(applicationId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('creates a workspace: namespace, metadata, capabilities, visibility', async () => {
    const { namespaceId } = await createWorkspace(mero.admin, {
      applicationId,
      name: 'Acme Legal',
      accountId,
    });
    expect(namespaceId).toMatch(/^[0-9a-f]{64}$/);

    const rows = await listWorkspaces(mero.admin, applicationId);
    const mine = rows.find((r) => r.namespaceId === namespaceId);
    expect(mine?.name).toBe('Acme Legal');
  }, 60_000);

  it('creates an agreement — subgroup, open, and a CONTEXT bound to it', async () => {
    // The call rc.41 broke. `group_id` has no default and every admin body is
    // `deny_unknown_fields`.
    const { namespaceId } = await createWorkspace(mero.admin, {
      applicationId,
      name: 'Contracts',
      accountId,
    });
    const created = await createAgreement(mero.admin, {
      applicationId,
      namespaceId,
      name: 'Q3 NDA',
    });
    expect(created.contextId).toMatch(/^[0-9a-f]{64}$/);
    expect(created.memberPublicKey).toMatch(/^[0-9a-f]{64}$/);

    const rows = await listAgreements(mero.admin, namespaceId);
    expect(rows.map((r) => r.name)).toContain('Q3 NDA');
    const row = rows.find((r) => r.name === 'Q3 NDA')!;
    expect(row.contextId).toBe(created.contextId);
    expect(row.joined).toBe(true);

    // And the contract answers in it, which is what says `init` really ran
    // with the two parameters the ABI declares.
    const details = await mero.rpc.execute({
      contextId: created.contextId,
      method: 'get_context_details',
      argsJson: { context_id_str: created.contextId },
    });
    expect(JSON.stringify(details)).toContain('Q3 NDA');
  }, 120_000);

  it('enters an agreement idempotently', async () => {
    const { namespaceId } = await createWorkspace(mero.admin, {
      applicationId,
      name: 'Re-enter',
      accountId,
    });
    const created = await createAgreement(mero.admin, {
      applicationId,
      namespaceId,
      name: 'Twice',
    });
    const first = await enterAgreement(mero.admin, {
      namespaceId,
      agreementId: created.agreementId,
      contextId: created.contextId,
    });
    const second = await enterAgreement(mero.admin, {
      namespaceId,
      agreementId: created.agreementId,
      contextId: created.contextId,
    });
    expect(second).toBe(first);
  }, 120_000);

  it('creates the private store in a personal namespace, found again by marker', async () => {
    const ns1 = await ensurePersonalWorkspace(mero.admin, applicationId);
    const ns2 = await ensurePersonalWorkspace(mero.admin, applicationId);
    expect(ns2).toBe(ns1);

    const created = await createPersonalContext(mero.admin, {
      applicationId,
      namespaceId: ns1,
      name: 'default',
    });
    expect(created.contextId).toMatch(/^[0-9a-f]{64}$/);

    // And it is NOT offered as a workspace.
    const rows = await listWorkspaces(mero.admin, applicationId);
    expect(rows.map((r) => r.namespaceId)).not.toContain(ns1);
  }, 120_000);

  it('mints a workspace invitation the node accepts back', async () => {
    const { namespaceId } = await createWorkspace(mero.admin, {
      applicationId,
      name: 'Invitable',
      accountId,
    });
    const res = await nodeApi(mero).contextInviteByOpenInvitation(namespaceId);
    expect(res.error ?? null).toBeNull();
    expect(res.data).toBeTruthy();
  }, 60_000);
});
