// ── One unlocked vault ───────────────────────────────────────────────────────
//
// Everything between "I have a context id" and "here are plaintext secrets":
// registering this device, opening the vault key from the wraps addressed to
// it, bootstrapping a key for a brand-new vault, handing the key on to members
// who are entitled to it, rotating it, and sealing/opening every field.
//
// It talks to the contract through `VaultApi` rather than the generated client
// directly, so the logic here is testable against an in-memory fake.

import {
  Keyring,
  SealError,
  type DeviceKeyPair,
  type VaultKey,
  fromB64,
  generateVaultKey,
  newSecretId,
  openField,
  sealField,
  toB64,
  unwrapVaultKey,
  wrapVaultKey,
} from './crypto';

// ── The contract surface this module needs ──────────────────────────────────

export type Role = 'admin' | 'editor' | 'viewer' | 'pending' | 'removed';

export interface VaultInfo {
  name: string;
  current_key: string;
  default_role: string;
  my_account: string;
  my_role: Role;
}

export interface SecretRecord {
  id: string;
  kind: string;
  name: string;
  tags: string;
  fields: Record<string, string>;
  created_at: number;
  created_by: string;
  updated_at: number;
  updated_by: string;
  trashed: boolean;
  trashed_at: number;
}

export interface RevisionRecord {
  field: string;
  previous: string;
  replaced_at: number;
  replaced_by: string;
}

/**
 * `browser`: a key pair that lives in one browser. `recovery`: a key pair the
 * user holds as a printed code (see the app's `recoveryKey.ts`); it never
 * unlocks anything on its own and never approves anyone. `agent`: the key of
 * software acting for its account (mero-bot). It is never let in by itself,
 * only an admin approves it, and it never hands a key to anyone.
 */
export type DeviceKind = 'browser' | 'recovery' | 'agent';

export interface DeviceRecord {
  fingerprint: string;
  public_key: string;
  label: string;
  kind: string;
  /**
   * The account that registered the device: the entry's owner stamp, which
   * every node verifies. Never a value the registrant wrote, so nobody can
   * register a key in a role holder's name to be handed the vault key.
   */
  account: string;
  added_at: number;
  revoked: boolean;
}

export interface MemberRecord {
  account: string;
  role: Role;
  devices: number;
}

export interface WrapRecord {
  key_id: string;
  recipient: string;
  wrapper: string;
  envelope: string;
}

export interface VaultApi {
  vaultInfo(): Promise<VaultInfo>;
  registerDevice(
    fingerprint: string,
    publicKey: string,
    label: string,
    kind: DeviceKind,
  ): Promise<void>;
  revokeDevice(fingerprint: string): Promise<void>;
  listDevices(): Promise<DeviceRecord[]>;
  listMembers(): Promise<MemberRecord[]>;
  keyWrapsFor(recipient: string): Promise<WrapRecord[]>;
  wrappedPairs(): Promise<string[]>;
  addKeyWraps(wraps: WrapRecord[]): Promise<number>;
  rotateKey(keyId: string): Promise<void>;
  setRole(account: string, role: 'admin' | 'editor' | 'viewer'): Promise<void>;
  removeMember(account: string): Promise<void>;
  listSecrets(): Promise<SecretRecord[]>;
  addSecret(
    id: string,
    kind: string,
    name: string,
    tags: string,
    fields: Record<string, string>,
  ): Promise<string>;
  updateSecret(
    id: string,
    name: string | null,
    tags: string | null,
    fields: Record<string, string>,
    rekey: boolean,
  ): Promise<void>;
  secretHistory(id: string): Promise<RevisionRecord[]>;
}

// ── Plaintext shapes ────────────────────────────────────────────────────────

export interface Secret {
  id: string;
  kind: string;
  name: string;
  tags: string[];
  fields: Record<string, string>;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
  trashed: boolean;
  trashedAt: number;
  /** True when some envelope did not open on this device. */
  unreadable: boolean;
}

export interface Revision {
  field: string;
  previous: string;
  replacedAt: number;
  replacedBy: string;
  unreadable: boolean;
}

export interface SecretDraft {
  kind: string;
  name: string;
  tags: string[];
  fields: Record<string, string>;
}

export type SessionState =
  /** Holds the current key: can read and (role permitting) write. */
  | 'ready'
  /** Registered, but nobody holding the key has wrapped it to this device yet. */
  | 'waiting'
  /** A fresh vault whose admin has not opened it yet, so there is no key. */
  | 'uninitialised';

/**
 * A short code derived from a device's fingerprint, shown both on the device
 * asking to be let in and on the one approving it, so the approver can tell
 * which request is the one in front of them.
 */
export function confirmationCode(fingerprint: string): string {
  const n = parseInt(fingerprint.slice(0, 8), 16) % 1_000_000;
  const d = String(n).padStart(6, '0');
  return `${d.slice(0, 3)} ${d.slice(3)}`;
}

/** How a recovery key is listed among a vault's devices. */
export const RECOVERY_LABEL = 'Recovery key';

const HELD_ROLES: readonly Role[] = ['admin', 'editor', 'viewer'];

/**
 * Which devices a key holder may wrap keys to without anyone being asked, and
 * which are waiting for approval.
 *
 * A device is **approved** once it holds any wrap: someone who had the key
 * chose to give it one. An unapproved device is **auto-entitled** only when
 * no other browser device of its account is approved and still listed, which
 * covers an account's first device and a replacement for a lost one that was
 * revoked. Any other new device must be approved by one of its account's
 * approved devices or by an admin (`VaultSession.approve`): a stranger who
 * can call the node as you gets a request on your screen, not your keys.
 *
 * Both classes need a device that is unrevoked, whose account holds a role,
 * and that is in `allowed` when given. Recovery devices are never
 * auto-entitled; they are given keys explicitly when they are created. Agent
 * devices are never auto-entitled either: each one waits for an admin, and
 * the contract counts only an admin's wrap to one as approving it.
 *
 * Everything this trusts comes from the contract's owner stamps: a device's
 * `account` is the account that registered it, and `pairs` counts only wraps
 * written by a role holder. So a pending or removed member can neither pass
 * off a device of theirs as a member's nor mark it approved with a wrap of
 * their own.
 */
export function classifyDevices(
  devices: DeviceRecord[],
  members: MemberRecord[],
  pairs: string[],
  allowed: Set<string> | null,
): { entitled: DeviceRecord[]; awaiting: DeviceRecord[] } {
  const role = new Map(members.map((m) => [m.account, m.role]));
  const holders = new Set(pairs.map((p) => p.slice(p.indexOf(':') + 1)));
  const live = devices.filter(
    (d) =>
      !d.revoked &&
      HELD_ROLES.includes(role.get(d.account) ?? 'pending') &&
      (!allowed || allowed.has(d.account)),
  );
  const accountsWithApproved = new Set(
    live
      .filter((d) => d.kind === 'browser' && holders.has(d.fingerprint))
      .map((d) => d.account),
  );
  const entitled: DeviceRecord[] = [];
  const awaiting: DeviceRecord[] = [];
  for (const d of live) {
    if (holders.has(d.fingerprint)) entitled.push(d);
    else if (d.kind === 'recovery') continue;
    else if (d.kind === 'agent') awaiting.push(d);
    else if (!accountsWithApproved.has(d.account)) entitled.push(d);
    else awaiting.push(d);
  }
  return { entitled, awaiting };
}

/**
 * Accounts that have registered only agent keys: software, not a person. An
 * admin's housekeeping never gives one the vault's default role; an admin
 * sets its role by hand.
 */
export function agentOnlyAccounts(devices: DeviceRecord[]): Set<string> {
  const kinds = new Map<string, Set<string>>();
  for (const d of devices) {
    if (d.revoked) continue;
    const set = kinds.get(d.account) ?? new Set<string>();
    set.add(d.kind);
    kinds.set(d.account, set);
  }
  const out = new Set<string>();
  for (const [account, set] of kinds) {
    if (set.size === 1 && set.has('agent')) out.add(account);
  }
  return out;
}

/** Reserved field names used for the name and tag list in the history. */
const NAME_FIELD = 'name';
const TAGS_FIELD = 'tags';

export class VaultSession {
  readonly keyring = new Keyring();
  info: VaultInfo | null = null;
  state: SessionState = 'waiting';

  /**
   * `kind` is what this session registers its key as: `browser` in the app,
   * `agent` in mero-bot. An agent session never creates a vault key, never
   * admits anyone and never hands a key on; it only reads, and writes if its
   * role lets it.
   */
  constructor(
    private api: VaultApi,
    private device: DeviceKeyPair,
    private fingerprint: string,
    private label: string,
    readonly kind: DeviceKind = 'browser',
  ) {}

  private get isAgent(): boolean {
    return this.kind === 'agent';
  }

  private get current(): VaultKey | undefined {
    return this.info ? this.keyring.get(this.info.current_key) : undefined;
  }

  get canWrite(): boolean {
    const role = this.info?.my_role;
    return this.state === 'ready' && (role === 'admin' || role === 'editor');
  }

  get isAdmin(): boolean {
    return this.info?.my_role === 'admin';
  }

  /**
   * Register this device, open every key wrapped to it, and bootstrap a key if
   * this is a new vault and we administer it.
   */
  async open(): Promise<SessionState> {
    await this.api.registerDevice(
      this.fingerprint,
      toB64(this.device.publicRaw),
      this.label,
      this.kind,
    );
    await this.refreshKeys();
    if (this.info && !this.info.current_key && this.isAdmin && !this.isAgent) {
      await this.bootstrap();
    }
    return this.state;
  }

  /** Re-read the vault info and pull in any wraps that arrived since. */
  async refreshKeys(): Promise<SessionState> {
    this.info = await this.api.vaultInfo();
    const wraps = await this.api.keyWrapsFor(this.fingerprint);
    for (const w of wraps) {
      if (this.keyring.has(w.key_id)) continue;
      const key = await unwrapVaultKey(w.envelope, w.key_id, this.device);
      if (key) this.keyring.add(key);
    }
    this.state = !this.info.current_key
      ? 'uninitialised'
      : this.keyring.has(this.info.current_key)
        ? 'ready'
        : 'waiting';
    return this.state;
  }

  private async bootstrap(): Promise<void> {
    const key = await generateVaultKey();
    await this.api.addKeyWraps([
      {
        key_id: key.keyId,
        recipient: this.fingerprint,
        wrapper: this.fingerprint,
        envelope: await wrapVaultKey(key, this.device.publicRaw),
      },
    ]);
    await this.api.rotateKey(key.keyId);
    this.keyring.add(key);
    await this.refreshKeys();
  }

  private async classify(allowed: Set<string> | null) {
    const [devices, members, pairs] = await Promise.all([
      this.api.listDevices(),
      this.api.listMembers(),
      this.api.wrappedPairs(),
    ]);
    return { ...classifyDevices(devices, members, pairs, allowed), pairs };
  }

  /**
   * Wrap `key` to every entitled device that does not have it yet (see
   * `classifyDevices`). `allowed`, when given, is the set of accounts still in
   * the team, which is how a member removed at the team level is kept out
   * even before a vault admin has run `remove_member`.
   */
  private async wrapToEntitled(
    key: VaultKey,
    allowed: Set<string> | null,
  ): Promise<number> {
    const { entitled, pairs } = await this.classify(allowed);
    const done = new Set(pairs);
    const wraps: WrapRecord[] = [];
    for (const d of entitled) {
      if (done.has(`${key.keyId}:${d.fingerprint}`)) continue;
      // The contract stores only an admin's wrap to an agent; anyone else's
      // would be dropped, so it is not sent.
      if (d.kind === 'agent' && !this.isAdmin) continue;
      wraps.push({
        key_id: key.keyId,
        recipient: d.fingerprint,
        wrapper: this.fingerprint,
        envelope: await wrapVaultKey(key, fromB64(d.public_key)),
      });
    }
    return wraps.length ? this.api.addKeyWraps(wraps) : 0;
  }

  /**
   * The background chores a key holder does whenever it opens the vault.
   *
   *   * Admins finish removals: anyone holding a vault role who is no longer
   *     in `allowed` (they were removed from the team, or from an invite-only
   *     vault) is removed here too, and the key is rotated so nothing written
   *     afterwards is readable to them.
   *   * Admins admit pending accounts that are in `allowed`, with the vault's
   *     default role.
   *   * Anyone holding the current key hands it to every entitled device that
   *     lacks it.
   *
   * Removal only runs against a listing that includes this account: an empty
   * or partial answer from a node that has not synced is not evidence that
   * everyone left.
   */
  async housekeep(
    allowed: Set<string> | null = null,
  ): Promise<{ admitted: number; wrapped: number; removed: number }> {
    let admitted = 0;
    let removed = 0;
    if (this.isAgent) return { admitted, wrapped: 0, removed };
    if (this.isAdmin && this.info) {
      const me = this.info.my_account;
      const members = await this.api.listMembers();
      if (allowed && allowed.has(me)) {
        for (const m of members) {
          const held =
            m.role === 'admin' || m.role === 'editor' || m.role === 'viewer';
          if (!held || m.account === me || allowed.has(m.account)) continue;
          await this.api.removeMember(m.account);
          removed += 1;
        }
        if (removed > 0) await this.rotate(allowed);
      }
      const role = this.info.default_role === 'viewer' ? 'viewer' : 'editor';
      const agents = agentOnlyAccounts(await this.api.listDevices());
      for (const m of members) {
        if (m.role !== 'pending') continue;
        if (allowed && !allowed.has(m.account)) continue;
        if (agents.has(m.account)) continue;
        await this.api.setRole(m.account, role);
        admitted += 1;
      }
    }
    const key = this.current;
    const wrapped = key ? await this.wrapToEntitled(key, allowed) : 0;
    return { admitted, wrapped, removed };
  }

  /**
   * Mint a new vault key, give it to everyone still entitled, switch to it,
   * and re-seal every secret under it. Admin only. `allowed` is the set of
   * accounts still in the team; anyone outside it gets nothing.
   */
  async rotate(
    allowed: Set<string> | null,
    onProgress: (done: number, total: number) => void = () => {},
  ): Promise<number> {
    if (!this.isAdmin || this.isAgent)
      throw new Error('Only a vault Admin can rotate the key.');
    const key = await generateVaultKey();
    this.keyring.add(key);
    await this.wrapToEntitled(key, allowed);
    // Our own device is always entitled — make sure, even if a listing lagged.
    await this.api.addKeyWraps([
      {
        key_id: key.keyId,
        recipient: this.fingerprint,
        wrapper: this.fingerprint,
        envelope: await wrapVaultKey(key, this.device.publicRaw),
      },
    ]);
    await this.api.rotateKey(key.keyId);
    await this.refreshKeys();

    const records = await this.api.listSecrets();
    let done = 0;
    for (const r of records) {
      const plain = await this.decrypt(r);
      if (plain.unreadable) continue;
      const sealed: Record<string, string> = {};
      for (const [f, v] of Object.entries(plain.fields)) {
        sealed[f] = await sealField(key, r.id, f, v);
      }
      await this.api.updateSecret(
        r.id,
        await sealField(key, r.id, NAME_FIELD, plain.name),
        await sealField(key, r.id, TAGS_FIELD, JSON.stringify(plain.tags)),
        sealed,
        true,
      );
      done += 1;
      onProgress(done, records.length);
    }
    return done;
  }

  /** Wrap every key in the keyring, old ones too, to one public key. */
  private async grant(recipient: string, publicRaw: Uint8Array) {
    const wraps: WrapRecord[] = [];
    for (const keyId of this.keyring.ids()) {
      const key = this.keyring.get(keyId);
      if (!key) continue;
      wraps.push({
        key_id: keyId,
        recipient,
        wrapper: this.fingerprint,
        envelope: await wrapVaultKey(key, publicRaw),
      });
    }
    if (wraps.length) await this.api.addKeyWraps(wraps);
    return wraps.length;
  }

  /**
   * Give every key this device holds to `next`: a new key pair for the same
   * browser (see `DeviceKeeper.setPassphrase`), a recovery key, or this browser
   * when restoring from one. Registers `next` and wraps each key in the
   * keyring to it — old keys too, so history stays readable. Returns how many
   * keys were handed over.
   */
  async handOver(
    next: Pick<DeviceKeyPair, 'publicRaw'>,
    nextFingerprint: string,
    label: string,
    kind: DeviceKind = 'browser',
  ): Promise<number> {
    await this.api.registerDevice(
      nextFingerprint,
      toB64(next.publicRaw),
      label,
      kind,
    );
    return this.grant(nextFingerprint, next.publicRaw);
  }

  /**
   * Give this account's recovery key every key in this vault. Called with
   * `replace` when a recovery key is created, which first withdraws any other
   * recovery key the account registered here; and without it on each vault
   * opened later with the key's public half remembered (`recoveryKey.ts`),
   * where a different recovery key of the account already registered here
   * wins — it is a newer one made in another browser, or one this browser
   * would otherwise fight over. A recovery key an admin revoked stays revoked.
   */
  async adoptRecoveryKey(
    recovery: { publicRaw: Uint8Array; fingerprint: string },
    replace = false,
  ): Promise<number> {
    if (this.state !== 'ready' || !this.info) return 0;
    const me = this.info.my_account;
    const devices = await this.api.listDevices();
    const others = devices.filter(
      (d) =>
        d.kind === 'recovery' &&
        d.account === me &&
        !d.revoked &&
        d.fingerprint !== recovery.fingerprint,
    );
    if (others.length && !replace) return 0;
    for (const d of others) await this.api.revokeDevice(d.fingerprint);
    const listed = devices.find((d) => d.fingerprint === recovery.fingerprint);
    if (listed?.revoked) return 0;
    const pairs = new Set(await this.api.wrappedPairs());
    const current = this.info.current_key;
    if (listed && pairs.has(`${current}:${recovery.fingerprint}`)) return 0;
    return this.handOver(
      recovery,
      recovery.fingerprint,
      RECOVERY_LABEL,
      'recovery',
    );
  }

  /** Withdraw this device from the vault, once its keys live elsewhere. */
  async retire(): Promise<void> {
    await this.api.revokeDevice(this.fingerprint);
  }

  // ── Device approval ─────────────────────────────────────────────────────

  /** Whether this device waits for approval rather than for any key holder. */
  async awaitingApproval(allowed: Set<string> | null = null) {
    const { awaiting } = await this.classify(allowed);
    return awaiting.some((d) => d.fingerprint === this.fingerprint);
  }

  /**
   * Devices this one could approve: its own account's new browsers, or
   * everyone's for an admin. An agent waits for an admin only. Empty unless
   * this device holds the current key, and always for an agent.
   */
  async pendingApprovals(
    allowed: Set<string> | null = null,
  ): Promise<DeviceRecord[]> {
    if (this.state !== 'ready' || !this.info || this.isAgent) return [];
    const me = this.info.my_account;
    const { awaiting } = await this.classify(allowed);
    return awaiting.filter(
      (d) =>
        d.fingerprint !== this.fingerprint &&
        (this.isAdmin || (d.account === me && d.kind !== 'agent')),
    );
  }

  /** Let a waiting device in: hand it every key this device holds. */
  async approve(device: DeviceRecord): Promise<number> {
    if (this.state !== 'ready')
      throw new Error('This device does not hold the vault key.');
    if (this.isAgent) throw new Error('An agent cannot approve devices.');
    if (device.kind === 'agent' && !this.isAdmin)
      throw new Error('Only a vault Admin can let an agent in.');
    return this.grant(device.fingerprint, fromB64(device.public_key));
  }

  /**
   * Turn a request down. It never received a key, so nothing needs to
   * rotate; an owner's revocation withdraws the registration, an admin's
   * marks it revoked.
   */
  async deny(device: DeviceRecord): Promise<void> {
    await this.api.revokeDevice(device.fingerprint);
  }

  /**
   * How many devices hold the current key. `browsers` counts the ones that
   * can open the vault day to day, `recovery` the recovery keys, `agents` the
   * agents. One browser and no recovery key means losing that browser loses
   * the vault, unless someone else holds it: an agent is not a way back in.
   */
  async holders(): Promise<{
    browsers: number;
    recovery: number;
    agents: number;
  }> {
    const current = this.info?.current_key;
    if (!current) return { browsers: 0, recovery: 0, agents: 0 };
    const [devices, pairs] = await Promise.all([
      this.api.listDevices(),
      this.api.wrappedPairs(),
    ]);
    const holding = new Set(
      pairs
        .filter((p) => p.startsWith(`${current}:`))
        .map((p) => p.slice(current.length + 1)),
    );
    let browsers = 0;
    let recovery = 0;
    let agents = 0;
    for (const d of devices) {
      if (d.revoked || !holding.has(d.fingerprint)) continue;
      if (d.kind === 'recovery') recovery += 1;
      else if (d.kind === 'agent') agents += 1;
      else browsers += 1;
    }
    return { browsers, recovery, agents };
  }

  // ── Secrets ─────────────────────────────────────────────────────────────

  private async open1(
    id: string,
    field: string,
    envelope: string,
  ): Promise<{ value: string; ok: boolean }> {
    try {
      return {
        value: await openField(this.keyring, id, field, envelope),
        ok: true,
      };
    } catch (e) {
      if (e instanceof SealError) return { value: '', ok: false };
      throw e;
    }
  }

  async decrypt(r: SecretRecord): Promise<Secret> {
    let unreadable = false;
    const name = await this.open1(r.id, NAME_FIELD, r.name);
    const tagsRaw = await this.open1(r.id, TAGS_FIELD, r.tags);
    unreadable ||= !name.ok || !tagsRaw.ok;
    let tags: string[] = [];
    try {
      tags = tagsRaw.value ? (JSON.parse(tagsRaw.value) as string[]) : [];
    } catch {
      tags = [];
    }
    const fields: Record<string, string> = {};
    for (const [f, env] of Object.entries(r.fields)) {
      const v = await this.open1(r.id, f, env);
      unreadable ||= !v.ok;
      fields[f] = v.value;
    }
    return {
      id: r.id,
      kind: r.kind,
      name: name.ok ? name.value : 'Locked item',
      tags,
      fields,
      createdAt: r.created_at,
      createdBy: r.created_by,
      updatedAt: r.updated_at,
      updatedBy: r.updated_by,
      trashed: r.trashed,
      trashedAt: r.trashed_at,
      unreadable,
    };
  }

  async list(): Promise<Secret[]> {
    const records = await this.api.listSecrets();
    return Promise.all(records.map((r) => this.decrypt(r)));
  }

  private requireKey(): VaultKey {
    const key = this.current;
    if (!key)
      throw new Error('This device has not been given the vault key yet.');
    return key;
  }

  async add(draft: SecretDraft): Promise<string> {
    const key = this.requireKey();
    const id = newSecretId();
    const fields: Record<string, string> = {};
    for (const [f, v] of Object.entries(draft.fields)) {
      if (v !== '') fields[f] = await sealField(key, id, f, v);
    }
    return this.api.addSecret(
      id,
      draft.kind,
      await sealField(key, id, NAME_FIELD, draft.name),
      await sealField(key, id, TAGS_FIELD, JSON.stringify(draft.tags)),
      fields,
    );
  }

  /**
   * Write only what changed relative to `before`. A field the user did not
   * touch is not sent, so it cannot overwrite a concurrent edit to it made on
   * another device.
   */
  async update(before: Secret, after: SecretDraft): Promise<void> {
    const key = this.requireKey();
    const id = before.id;
    const fields: Record<string, string> = {};
    const names = new Set([
      ...Object.keys(before.fields),
      ...Object.keys(after.fields),
    ]);
    for (const f of names) {
      const next = after.fields[f] ?? '';
      if (next === (before.fields[f] ?? '')) continue;
      fields[f] = await sealField(key, id, f, next);
    }
    const name =
      after.name !== before.name
        ? await sealField(key, id, NAME_FIELD, after.name)
        : null;
    const tagsChanged =
      JSON.stringify(after.tags) !== JSON.stringify(before.tags);
    const tags = tagsChanged
      ? await sealField(key, id, TAGS_FIELD, JSON.stringify(after.tags))
      : null;
    if (!name && !tags && Object.keys(fields).length === 0) return;
    await this.api.updateSecret(id, name, tags, fields, false);
  }

  async history(id: string): Promise<Revision[]> {
    const revs = await this.api.secretHistory(id);
    return Promise.all(
      revs.map(async (r) => {
        const v = await this.open1(id, r.field, r.previous);
        return {
          field: r.field,
          previous: v.value,
          replacedAt: r.replaced_at,
          replacedBy: r.replaced_by,
          unreadable: !v.ok,
        };
      }),
    );
  }
}
