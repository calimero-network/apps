// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { fingerprintOf, generateDeviceKey, keyIdOf } from './crypto';
import {
  confirmationCode,
  type DeviceRecord,
  type Role,
  type SecretRecord,
  type VaultApi,
  type WrapRecord,
  VaultSession,
} from './vaultSession';

// ── A shared in-memory vault, and one API handle per person ─────────────────
//
// Mirrors the contract's rules closely enough to exercise the session: roles,
// the device registry, wraps that only land on registered unrevoked devices,
// and field-level updates.

class FakeVault {
  name = 'Team vault';
  currentKey = '';
  defaultRole = 'editor';
  roles = new Map<string, Role>();
  devices = new Map<string, DeviceRecord>();
  wraps = new Map<string, WrapRecord>();
  secrets = new Map<string, SecretRecord>();
  history: { id: string; field: string; previous: string }[] = [];

  constructor(creator: string) {
    this.roles.set(creator, 'admin');
  }

  private state(): FakeVault {
    return this;
  }

  as(account: string): VaultApi {
    // The handle closes over the shared state, not over `this`.
    const v = this.state();
    const role = () => v.roles.get(account) ?? 'pending';
    const mustWrite = () => {
      if (role() !== 'admin' && role() !== 'editor')
        throw new Error('view-only');
    };
    return {
      async vaultInfo() {
        return {
          name: v.name,
          current_key: v.currentKey,
          default_role: v.defaultRole,
          my_account: account,
          my_role: role(),
        };
      },
      async registerDevice(fingerprint, publicKey, label, kind) {
        if (!v.devices.has(fingerprint)) {
          v.devices.set(fingerprint, {
            fingerprint,
            public_key: publicKey,
            label,
            kind,
            account,
            added_at: 0,
            revoked: false,
          });
        }
      },
      async revokeDevice(fingerprint) {
        const d = v.devices.get(fingerprint);
        if (!d) throw new Error('no such device');
        if (d.account === account) v.devices.delete(fingerprint);
        else if (role() === 'admin') d.revoked = true;
        else throw new Error('owner or admin only');
      },
      async listDevices() {
        return [...v.devices.values()];
      },
      async listMembers() {
        const out = new Map<string, Role>(v.roles);
        for (const d of v.devices.values()) {
          if (!out.has(d.account)) out.set(d.account, 'pending');
        }
        return [...out].map(([a, r]) => ({ account: a, role: r, devices: 0 }));
      },
      async keyWrapsFor(recipient) {
        return [...v.wraps.values()].filter((w) => w.recipient === recipient);
      },
      async wrappedPairs() {
        return [...v.wraps.values()].map((w) => `${w.key_id}:${w.recipient}`);
      },
      async addKeyWraps(wraps) {
        let n = 0;
        for (const w of wraps) {
          const d = v.devices.get(w.recipient);
          if (!d || d.revoked) continue;
          const slot = `${w.key_id}:${w.recipient}:${w.wrapper}`;
          if (v.wraps.has(slot)) continue;
          v.wraps.set(slot, w);
          n += 1;
        }
        return n;
      },
      async rotateKey(keyId) {
        if (role() !== 'admin') throw new Error('admin only');
        v.currentKey = keyId;
      },
      async setRole(target, r) {
        if (role() !== 'admin') throw new Error('admin only');
        v.roles.set(target, r);
      },
      async removeMember(target) {
        if (role() !== 'admin') throw new Error('admin only');
        v.roles.set(target, 'removed');
        for (const d of v.devices.values())
          if (d.account === target) d.revoked = true;
      },
      async listSecrets() {
        return [...v.secrets.values()].map((s) => ({
          ...s,
          fields: { ...s.fields },
        }));
      },
      async addSecret(id, kind, name, tags, fields) {
        mustWrite();
        v.secrets.set(id, {
          id,
          kind,
          name,
          tags,
          fields: { ...fields },
          created_at: 1,
          created_by: account,
          updated_at: 1,
          updated_by: account,
          trashed: false,
          trashed_at: 0,
        });
        return id;
      },
      async updateSecret(id, name, tags, fields, rekey) {
        mustWrite();
        const s = v.secrets.get(id)!;
        const note = (field: string, previous: string) => {
          if (!rekey && previous) v.history.push({ id, field, previous });
        };
        if (name !== null) {
          note('name', s.name);
          s.name = name;
        }
        if (tags !== null) {
          note('tags', s.tags);
          s.tags = tags;
        }
        for (const [f, val] of Object.entries(fields)) {
          note(f, s.fields[f] ?? '');
          if (val === '') delete s.fields[f];
          else s.fields[f] = val;
        }
      },
      async secretHistory(id) {
        return v.history
          .filter((h) => h.id === id)
          .map((h) => ({
            field: h.field,
            previous: h.previous,
            replaced_at: 1,
            replaced_by: '',
          }));
      },
    };
  }
}

async function person(vault: FakeVault, account: string) {
  return browser(vault, account);
}

/** Another browser of an account that may already have one. */
async function browser(vault: FakeVault, account: string) {
  const device = await generateDeviceKey();
  const fp = await fingerprintOf(device.publicRaw);
  return {
    fp,
    session: new VaultSession(vault.as(account), device, fp, 'test'),
  };
}

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

describe('VaultSession', () => {
  it('bootstraps a key for a new vault and seals everything it writes', async () => {
    const vault = new FakeVault(ALICE);
    const { session } = await person(vault, ALICE);
    expect(await session.open()).toBe('ready');
    expect(vault.currentKey).toMatch(/^[0-9a-f]{64}$/);

    const id = await session.add({
      kind: 'login',
      name: 'GitHub',
      tags: ['dev'],
      fields: { username: 'alice', password: 'hunter2' },
    });
    const stored = vault.secrets.get(id)!;
    const onDisk = JSON.stringify(stored);
    expect(onDisk).not.toContain('GitHub');
    expect(onDisk).not.toContain('hunter2');
    expect(onDisk).not.toContain('dev');
    expect(keyIdOf(stored.fields.password)).toBe(vault.currentKey);

    const [plain] = await session.list();
    expect(plain.name).toBe('GitHub');
    expect(plain.tags).toEqual(['dev']);
    expect(plain.fields.password).toBe('hunter2');
    expect(plain.unreadable).toBe(false);
  });

  it('a newcomer waits until a key holder admits them, then reads', async () => {
    const vault = new FakeVault(ALICE);
    const alice = await person(vault, ALICE);
    await alice.session.open();
    await alice.session.add({
      kind: 'login',
      name: 'Bank',
      tags: [],
      fields: { password: 'p' },
    });

    const bob = await person(vault, BOB);
    expect(await bob.session.open()).toBe('waiting');
    const [locked] = await bob.session.list();
    expect(locked.unreadable).toBe(true);

    // Alice opens the vault again: Bob is admitted with the default role and
    // his device gets the key.
    const chores = await alice.session.housekeep();
    expect(chores).toEqual({ admitted: 1, wrapped: 1, removed: 0 });
    expect(vault.roles.get(BOB)).toBe('editor');

    expect(await bob.session.refreshKeys()).toBe('ready');
    const [open] = await bob.session.list();
    expect(open.fields.password).toBe('p');
    expect(bob.session.canWrite).toBe(true);
  });

  it('does not admit an account outside the allowed set', async () => {
    const vault = new FakeVault(ALICE);
    const alice = await person(vault, ALICE);
    await alice.session.open();
    const bob = await person(vault, BOB);
    await bob.session.open();
    const chores = await alice.session.housekeep(new Set([ALICE]));
    expect(chores).toEqual({ admitted: 0, wrapped: 0, removed: 0 });
    expect(await bob.session.refreshKeys()).toBe('waiting');
  });

  it('sends only the fields that changed', async () => {
    const vault = new FakeVault(ALICE);
    const { session } = await person(vault, ALICE);
    await session.open();
    const id = await session.add({
      kind: 'login',
      name: 'Mail',
      tags: [],
      fields: { username: 'u', password: 'old', url: 'https://mail' },
    });
    const before = (await session.list())[0];
    const urlEnvelope = vault.secrets.get(id)!.fields.url;

    await session.update(before, {
      ...before,
      fields: { ...before.fields, password: 'new' },
    });

    expect(vault.secrets.get(id)!.fields.url).toBe(urlEnvelope);
    const history = await session.history(id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      field: 'password',
      previous: 'old',
      unreadable: false,
    });
  });

  it('rotation locks out a removed member from anything written afterwards', async () => {
    const vault = new FakeVault(ALICE);
    const alice = await person(vault, ALICE);
    await alice.session.open();
    const bob = await person(vault, BOB);
    await bob.session.open();
    await alice.session.housekeep();
    await bob.session.refreshKeys();
    const oldKey = vault.currentKey;

    // Bob leaves the team. Alice rotates with Bob outside the allowed set.
    vault.roles.delete(BOB);
    await alice.session.add({
      kind: 'login',
      name: 'Before',
      tags: [],
      fields: { password: 'b' },
    });
    const rekeyed = await alice.session.rotate(new Set([ALICE]));
    expect(rekeyed).toBe(1);
    expect(vault.currentKey).not.toBe(oldKey);
    await alice.session.add({
      kind: 'login',
      name: 'After',
      tags: [],
      fields: { password: 'a' },
    });

    // Every stored envelope is now under the new key...
    for (const s of vault.secrets.values()) {
      expect(keyIdOf(s.fields.password)).toBe(vault.currentKey);
    }
    // ...which Bob never received.
    await bob.session.refreshKeys();
    expect(bob.session.state).toBe('waiting');
    const seen = await bob.session.list();
    expect(seen.every((s) => s.unreadable)).toBe(true);

    // Alice still reads everything, and a rekey wrote no history.
    const mine = await alice.session.list();
    expect(mine.map((s) => s.fields.password).sort()).toEqual(['a', 'b']);
    expect(vault.history).toHaveLength(0);
  });

  it('an admin finishes a team-level removal the next time it opens the vault', async () => {
    const vault = new FakeVault(ALICE);
    const alice = await person(vault, ALICE);
    await alice.session.open();
    const bob = await person(vault, BOB);
    await bob.session.open();
    await alice.session.housekeep(new Set([ALICE, BOB]));
    await bob.session.refreshKeys();
    const oldKey = vault.currentKey;

    // Bob was removed from the team; the node's listing no longer has him.
    const chores = await alice.session.housekeep(new Set([ALICE]));
    expect(chores.removed).toBe(1);
    expect(vault.roles.get(BOB)).toBe('removed');
    expect(vault.currentKey).not.toBe(oldKey);
    await bob.session.refreshKeys();
    expect(bob.session.state).toBe('waiting');
  });

  it('does not remove anyone on a listing that does not include itself', async () => {
    const vault = new FakeVault(ALICE);
    const alice = await person(vault, ALICE);
    await alice.session.open();
    vault.roles.set(BOB, 'editor');
    const chores = await alice.session.housekeep(new Set());
    expect(chores.removed).toBe(0);
    expect(vault.roles.get(BOB)).toBe('editor');
  });

  it('hands every key over to a new key pair for the same browser', async () => {
    const vault = new FakeVault(ALICE);
    const alice = await person(vault, ALICE);
    await alice.session.open();
    await alice.session.add({
      kind: 'login',
      name: 'Old',
      tags: [],
      fields: { password: 'o' },
    });
    await alice.session.rotate(null);

    const next = await generateDeviceKey();
    const nextFp = await fingerprintOf(next.publicRaw);
    expect(await alice.session.handOver(next, nextFp, 'pin')).toBe(2);

    const after = new VaultSession(vault.as(ALICE), next, nextFp, 'pin');
    expect(await after.open()).toBe('ready');
    expect(after.keyring.size).toBe(2);
    expect((await after.list())[0].fields.password).toBe('o');
  });

  it('a viewer is told it cannot write', async () => {
    const vault = new FakeVault(ALICE);
    vault.defaultRole = 'viewer';
    const alice = await person(vault, ALICE);
    await alice.session.open();
    const bob = await person(vault, BOB);
    await bob.session.open();
    await alice.session.housekeep();
    await bob.session.refreshKeys();
    expect(bob.session.state).toBe('ready');
    expect(bob.session.canWrite).toBe(false);
  });
});

describe('device approval', () => {
  async function aliceWithBob() {
    const vault = new FakeVault(ALICE);
    const alice = await person(vault, ALICE);
    await alice.session.open();
    const bob = await person(vault, BOB);
    await bob.session.open();
    await alice.session.housekeep();
    await bob.session.refreshKeys();
    return { vault, alice, bob };
  }

  it('a second browser of an account waits, even when others hold the key', async () => {
    const { alice, bob, vault } = await aliceWithBob();
    const bob2 = await browser(vault, BOB);
    expect(await bob2.session.open()).toBe('waiting');
    expect(await bob2.session.awaitingApproval()).toBe(true);

    // Alice's and Bob's routine chores do not hand it the key.
    expect((await alice.session.housekeep()).wrapped).toBe(0);
    expect((await bob.session.housekeep()).wrapped).toBe(0);
    expect(await bob2.session.refreshKeys()).toBe('waiting');

    // It shows up for Bob's approved browser and for the admin, not for
    // itself.
    const forBob = await bob.session.pendingApprovals();
    expect(forBob.map((d) => d.fingerprint)).toEqual([bob2.fp]);
    expect(await alice.session.pendingApprovals()).toHaveLength(1);
    expect(await bob2.session.pendingApprovals()).toEqual([]);

    expect(await bob.session.approve(forBob[0])).toBe(1);
    expect(await bob2.session.refreshKeys()).toBe('ready');
    expect(await bob.session.pendingApprovals()).toEqual([]);
  });

  it('an editor sees only its own account’s requests', async () => {
    const { alice, bob, vault } = await aliceWithBob();
    await (await browser(vault, ALICE)).session.open();
    expect(await bob.session.pendingApprovals()).toEqual([]);
    expect(await alice.session.pendingApprovals()).toHaveLength(1);
  });

  it('a denied request is withdrawn and never gets a key', async () => {
    const { bob, vault } = await aliceWithBob();
    const bob2 = await browser(vault, BOB);
    await bob2.session.open();
    const [req] = await bob.session.pendingApprovals();
    await bob.session.deny(req);
    expect(vault.devices.has(bob2.fp)).toBe(false);
    expect(await bob.session.pendingApprovals()).toEqual([]);
  });

  it('a replacement for a revoked browser is let in without approval', async () => {
    const { alice, bob, vault } = await aliceWithBob();
    await alice.session.deny(vault.devices.get(bob.fp)!);
    expect(vault.devices.get(bob.fp)!.revoked).toBe(true);

    const bob2 = await browser(vault, BOB);
    await bob2.session.open();
    expect(await bob2.session.awaitingApproval()).toBe(false);
    expect((await alice.session.housekeep()).wrapped).toBe(1);
    expect(await bob2.session.refreshKeys()).toBe('ready');
  });

  it('rotation reaches approved devices and recovery keys, not requests', async () => {
    const { alice, bob, vault } = await aliceWithBob();
    const rec = await generateDeviceKey();
    const recFp = await fingerprintOf(rec.publicRaw);
    await bob.session.handOver(rec, recFp, 'Recovery key', 'recovery');
    const bob2 = await browser(vault, BOB);
    await bob2.session.open();

    await alice.session.rotate(null);
    const holding = [...vault.wraps.values()]
      .filter((w) => w.key_id === vault.currentKey)
      .map((w) => w.recipient)
      .sort();
    expect(holding).toEqual([alice.fp, bob.fp, recFp].sort());
    expect(await alice.session.holders()).toEqual({ browsers: 2, recovery: 1 });
  });

  it('a recovery key never needs, or grants, approval', async () => {
    const vault = new FakeVault(ALICE);
    const alice = await person(vault, ALICE);
    await alice.session.open();
    const rec = await generateDeviceKey();
    const recFp = await fingerprintOf(rec.publicRaw);
    await alice.session.handOver(rec, recFp, 'Recovery key', 'recovery');
    expect(await alice.session.pendingApprovals()).toEqual([]);
    expect(await alice.session.holders()).toEqual({ browsers: 1, recovery: 1 });

    // Restoring: the recovery pair opens the vault and hands this browser
    // the keys.
    const restorer = new VaultSession(vault.as(ALICE), rec, recFp, 'r');
    expect(await restorer.refreshKeys()).toBe('ready');
    const fresh = await generateDeviceKey();
    const freshFp = await fingerprintOf(fresh.publicRaw);
    expect(await restorer.handOver(fresh, freshFp, 'browser')).toBe(1);
    const after = new VaultSession(vault.as(ALICE), fresh, freshFp, 'b');
    expect(await after.open()).toBe('ready');
  });

  it('a new recovery key replaces the old one, and is not re-given', async () => {
    const vault = new FakeVault(ALICE);
    const alice = await person(vault, ALICE);
    await alice.session.open();
    const mk = async () => {
      const k = await generateDeviceKey();
      return {
        publicRaw: k.publicRaw,
        fingerprint: await fingerprintOf(k.publicRaw),
      };
    };
    const first = await mk();
    expect(await alice.session.adoptRecoveryKey(first)).toBe(1);
    expect(await alice.session.adoptRecoveryKey(first)).toBe(0);
    // A different remembered key does not displace it in the background...
    const second = await mk();
    expect(await alice.session.adoptRecoveryKey(second)).toBe(0);
    expect(vault.devices.has(second.fingerprint)).toBe(false);
    // ...only an explicit replacement does.
    expect(await alice.session.adoptRecoveryKey(second, true)).toBe(1);
    expect(vault.devices.has(first.fingerprint)).toBe(false);
    expect(vault.devices.get(second.fingerprint)?.kind).toBe('recovery');
  });

  it('confirmation codes are six digits in two groups', () => {
    expect(confirmationCode('0'.repeat(64))).toBe('000 000');
    expect(confirmationCode('ffffffff' + '0'.repeat(56))).toMatch(
      /^\d{3} \d{3}$/,
    );
  });
});
