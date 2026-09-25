// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { fingerprintOf, generateDeviceKey, keyIdOf } from './crypto';
import {
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
      async registerDevice(fingerprint, publicKey, label) {
        if (!v.devices.has(fingerprint)) {
          v.devices.set(fingerprint, {
            fingerprint,
            public_key: publicKey,
            label,
            account,
            added_at: 0,
            revoked: false,
          });
        }
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
