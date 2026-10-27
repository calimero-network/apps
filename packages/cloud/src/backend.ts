/**
 * The release-v2 (Calimero Cloud) backend behind the app-facing API the apps
 * were written against.
 *
 * The apps speak v1's vocabulary: namespaces, groups, contexts, an admin API
 * and a JSON-RPC transport. release-v2 has the same things under other names,
 * so this maps one onto the other instead of rewriting every app:
 *
 * | v1 (what an app calls)        | release-v2 (what runs)                        |
 * | ----------------------------- | --------------------------------------------- |
 * | namespace                     | organization (`orgId`)                        |
 * | its root group                | the organization itself (group id = `orgId`)  |
 * | subgroup                      | team (group id = `orgId.teamId`)              |
 * | context                       | app instance (context id = hex SHA-256(appId), which the cluster accepts wherever it takes an app id) |
 * | application id                | signed package (`package:<name>[@<version>]`), or a bundle hash on a development cluster |
 * | member identity               | account id                                    |
 * | signed open invitation        | invitation token (wrapped, see `invitationOf`)|
 * | `rpc.execute`                 | `POST /apps/{app}/intents`                    |
 * | `/sse` subscription           | `GET /apps/{app}/events` per context          |
 *
 * What release-v2 does not have yet answers with {@link NotOnCloudError}, named
 * for what was asked, rather than pretending to work.
 */

import {
  CalimeroClient,
  CalimeroError,
  browserPasskey,
  type CalimeroSession,
  type CloudPolicy,
  type PasskeyProvider,
} from '@calimero-network/mero-js';

import { AuthRevokedError, HTTPError } from './vendor/errors.js';
import { classifyError } from './vendor/classify.js';
import { redeemInvitation as redeemParsedInvitation } from './vendor/redeem-invitation.js';

export * from './vendor/capabilities.js';
export { classifyError, messageOf, statusOf } from './vendor/classify.js';
export { AuthRevokedError, HTTPError, RelayLoginError, RequestAuthError } from './vendor/errors.js';
export { isSettled, shouldRetain } from './vendor/redeem-invitation.js';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// ---------------------------------------------------------------- errors

/** Something release-v2 does not offer (yet). The message names it. */
export class NotOnCloudError extends Error {
  readonly method: string;
  constructor(method: string, why = 'release-v2 has no equivalent yet') {
    super(`${method} is not available on Calimero Cloud: ${why}`);
    this.name = 'NotOnCloudError';
    this.method = method;
  }
}

/** v1's JSON-RPC error: what an app call that the app refused looks like. */
export class RpcError extends Error {
  code: number;
  type?: string;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown, type?: string) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
    this.type = type;
  }
}

/** v1 named accounts on a relay; kept so `instanceof` checks keep compiling. */
export class NotForAccountError extends Error {
  readonly method: string;
  constructor(method: string) {
    super(`${method} is not available to an account`);
    this.name = 'NotForAccountError';
    this.method = method;
  }
}
export class NoRelayError extends Error {
  readonly method: string;
  constructor(method: string) {
    super(`${method}: there are no relays on Calimero Cloud`);
    this.name = 'NoRelayError';
    this.method = method;
  }
}
export class InvitationNotClaimableError extends Error {}

/** A cluster refusal as v1's `HTTPError`, which every app's error handling reads. */
function asHttpError(err: unknown, url: string): unknown {
  if (err instanceof CalimeroError) {
    const body = JSON.stringify({ error: err.message.replace(/^\d+ \w+: /, ''), code: err.code, details: err.details });
    const headers = new Headers();
    if (err.status === 401 && err.code === 'TOKEN_REUSE') {
      return new AuthRevokedError('token_reuse', err.status, err.code, url, headers, body);
    }
    return new HTTPError(err.status, err.code, url, headers, body);
  }
  if (err instanceof TypeError) {
    // The fetch itself failed: no answer at all.
    return new HTTPError(0, 'Network Error', url, new Headers(), err.message);
  }
  return err;
}

// ---------------------------------------------------------------- config

/**
 * Where the cluster is and how its quotes are judged.
 *
 * `VITE_CALIMERO_URL` names any node of the cluster. A development cluster
 * (`merod-v2 local`) produces mock quotes, which are trusted only when
 * `VITE_CALIMERO_ALLOW_MOCK=true` or the cluster is on this machine; a
 * production build passes a real `verifyQuote` through {@link configureCloud}.
 */
interface CloudConfig {
  url: string;
  policy: CloudPolicy;
  passkey: PasskeyProvider;
}

/**
 * Build-time settings. Read as static `import.meta.env.X` expressions, the only
 * form Vite replaces in every mode (a computed key reads `undefined` in tests
 * and may in builds).
 */
function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
function env(name: 'VITE_CALIMERO_URL' | 'VITE_CALIMERO_ALLOW_MOCK' | 'VITE_CALIMERO_BUNDLE'): string | undefined {
  try {
    switch (name) {
      case 'VITE_CALIMERO_URL':
        return nonEmpty(import.meta.env.VITE_CALIMERO_URL);
      case 'VITE_CALIMERO_ALLOW_MOCK':
        return nonEmpty(import.meta.env.VITE_CALIMERO_ALLOW_MOCK);
      case 'VITE_CALIMERO_BUNDLE':
        return nonEmpty(import.meta.env.VITE_CALIMERO_BUNDLE);
    }
  } catch {
    return undefined;
  }
}

const DEFAULT_CLUSTER_URL = env('VITE_CALIMERO_URL') ?? 'http://127.0.0.1:2501';

/**
 * Whether this build trusts mock quotes: only when it was built with
 * `VITE_CALIMERO_ALLOW_MOCK=true`, never by default and never because the
 * cluster looks local. A mock quote proves nothing about the node, so a build
 * that accepted one would hand a passkey ceremony (and everything after it) to
 * whoever answers at the URL.
 */
export function mockQuotesAllowed(): boolean {
  return env('VITE_CALIMERO_ALLOW_MOCK') === 'true';
}

let config: CloudConfig | null = null;

/** Override the cluster, the quote policy or the passkey provider (tests, production builds). */
export function configureCloud(next: Partial<CloudConfig>): void {
  config = { ...currentConfig(), ...next };
}

function currentConfig(url?: string): CloudConfig {
  const base = url ?? config?.url ?? DEFAULT_CLUSTER_URL;
  return {
    url: base,
    policy: config?.policy ?? { allowMock: mockQuotesAllowed() },
    passkey: config?.passkey ?? browserPasskey(),
  };
}

export function defaultClusterUrl(): string {
  return config?.url ?? DEFAULT_CLUSTER_URL;
}

// ---------------------------------------------------------------- ids

/** A group id: the organization itself, or one of its teams. */
export function groupIdOf(org: string, team?: string | null): string {
  return team ? `${org}.${team}` : org;
}

export function parseGroupId(groupId: string): { org: string; team: string | null } {
  const dot = groupId.indexOf('.');
  return dot < 0 ? { org: groupId, team: null } : { org: groupId.slice(0, dot), team: groupId.slice(dot + 1) };
}

/** The context id the cluster derives for an app: hex SHA-256 of its id. */
export async function contextIdOf(appId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(appId));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- session

/**
 * The session token never reaches `localStorage`, where any script on any page
 * of the origin, now or later, reads it. It lives in memory; the tab keeps
 * only the refresh token, in `sessionStorage` (gone when the tab closes), and
 * a reload trades it for a new session.
 */
const SESSION_KEY = 'calimero-cloud:refresh';
const LEGACY_KEYS = ['calimero-cloud:session'];

let memorySession: CalimeroSession | null = null;

function tabStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function forgetLegacy(): void {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {
    // No localStorage: nothing to forget.
  }
}

/** The session: the one in memory, or a refreshable stub from this tab's storage. */
export function readSession(): CalimeroSession | null {
  if (memorySession) return memorySession;
  forgetLegacy();
  try {
    const raw = tabStorage()?.getItem(SESSION_KEY);
    if (!raw) return null;
    const { accountId, refreshToken } = JSON.parse(raw) as { accountId: string; refreshToken: string };
    // No session token and already expired: the first request refreshes it.
    return accountId && refreshToken ? { accountId, refreshToken, sessionToken: '', expiresAt: 0 } : null;
  } catch {
    return null;
  }
}

export function writeSession(session: CalimeroSession | null): void {
  memorySession = session;
  forgetLegacy();
  try {
    if (session) tabStorage()?.setItem(SESSION_KEY, JSON.stringify({ accountId: session.accountId, refreshToken: session.refreshToken }));
    else tabStorage()?.removeItem(SESSION_KEY);
  } catch {
    // Storage blocked: the session lasts as long as this page.
  }
}

// ---------------------------------------------------------------- the client

/**
 * The connected client, in the shape an app's `useMero().mero` had: `rpc` (an
 * `ExecuteTransport`, which generated ABI clients take), `admin`, `events`
 * and `ephemeral`.
 */
export class CloudMero {
  readonly client: CalimeroClient;
  readonly baseUrl: string;
  readonly admin: CloudAdmin;
  readonly rpc: CloudRpc;
  readonly events: CloudEvents;
  readonly ephemeral: LocalEphemeral;
  readonly isDelegated = false;
  private me: Promise<Json> | null = null;

  /** A cluster URL, or v1's `MeroJs` config (`{ baseUrl, tokenStore, timeoutMs }`). */
  constructor(urlOrConfig?: string | { baseUrl?: string }) {
    const url = typeof urlOrConfig === 'string' ? urlOrConfig : urlOrConfig?.baseUrl;
    const cfg = currentConfig(url);
    this.baseUrl = cfg.url.replace(/\/+$/, '');
    this.client = new CalimeroClient({ baseUrl: this.baseUrl, policy: cfg.policy });
    const saved = readSession();
    if (saved) this.client.useSession(saved);
    this.admin = new CloudAdmin(this);
    this.rpc = new CloudRpc(this);
    this.events = new CloudEvents(this);
    this.ephemeral = new LocalEphemeral(this);
  }

  get passkey(): PasskeyProvider {
    return currentConfig(this.baseUrl).passkey;
  }

  get session(): CalimeroSession | undefined {
    return this.client.session;
  }

  /** v1 handed out its token bundle; the cloud's session plays that part. */
  getTokenData(): { access_token: string; refresh_token: string; expires_at: number } | null {
    const s = this.client.session;
    return s ? { access_token: s.sessionToken, refresh_token: s.refreshToken, expires_at: s.expiresAt } : null;
  }

  async signIn(): Promise<CalimeroSession> {
    const session = await this.client.signIn(this.passkey);
    writeSession(session);
    this.me = null;
    return session;
  }

  async signUp(name: string): Promise<CalimeroSession> {
    const session = await this.client.signUp(this.passkey, name);
    writeSession(session);
    this.me = null;
    return session;
  }

  /** Whether the saved session still works, refreshing it if it has expired. */
  async validate(): Promise<boolean> {
    if (!this.client.session) return false;
    try {
      if (this.client.session.expiresAt * 1000 < Date.now() + 30_000) {
        writeSession(await this.client.refresh());
      }
      await this.whoami(true);
      return true;
    } catch {
      return false;
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.client.signOut();
    } catch {
      // Already gone on the cluster's side.
    }
    writeSession(null);
    this.me = null;
  }

  /** `/auth/me`: the account, its passkeys and its organizations. */
  whoami(fresh = false): Promise<Json> {
    if (fresh || !this.me) {
      this.me = this.request('/auth/me', () => this.client.me()).catch((e) => {
        this.me = null;
        throw e;
      });
    }
    return this.me;
  }

  async accountId(): Promise<string> {
    return (await this.whoami()).accountId as string;
  }

  /** Run a cluster request, refreshing an expired session once, and report failures as v1 did. */
  async request<T>(path: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof CalimeroError && err.status === 401 && this.client.session) {
        try {
          writeSession(await this.client.refresh());
          return await run();
        } catch (retry) {
          throw asHttpError(retry, this.baseUrl + path);
        }
      }
      throw asHttpError(err, this.baseUrl + path);
    }
  }

  get<T = Json>(path: string): Promise<T> {
    return this.request(path, () => this.client.get<T>(path));
  }
  post<T = Json>(path: string, body: unknown = {}): Promise<T> {
    return this.request(path, () => this.client.post<T>(path, body));
  }
  delete<T = Json>(path: string): Promise<T> {
    return this.request(path, () => this.client.delete<T>(path));
  }

  close(): void {
    this.events.close();
  }
}

// ---------------------------------------------------------------- rpc

/** v1's `ExecuteTransport`: one method in one context. */
export class CloudRpc {
  readonly kind = 'node';
  readonly canSubscribe = true;
  constructor(private readonly mero: CloudMero) {}

  async execute<T = unknown>(params: { contextId: string; method: string; argsJson?: Record<string, unknown> }): Promise<T> {
    const { result } = await this.executeWithMeta<T>(params);
    return result;
  }

  async executeWithMeta<T = unknown>(params: {
    contextId: string;
    method: string;
    argsJson?: Record<string, unknown>;
  }): Promise<{ result: T; index: number; events: Array<{ kind: string; data: unknown }> }> {
    const { contextId, method, argsJson = {} } = params;
    try {
      const out = await this.mero.client.call(contextId, method, argsJson);
      return { result: out.result as T, index: out.index, events: out.events };
    } catch (err) {
      if (err instanceof CalimeroError && (err.code === 'APP_ERROR' || err.code === 'TRAP')) {
        // v1 reported an app's own refusal as a JSON-RPC error carrying its payload.
        const detail = (err.details as Json)?.error;
        const message = typeof detail === 'string' ? detail : JSON.stringify(detail ?? err.message);
        throw new RpcError(-32000, message, detail, err.code === 'TRAP' ? 'FunctionCallError' : 'ExecutionError');
      }
      throw asHttpError(err, `${this.mero.baseUrl}/apps/${contextId}/intents`);
    }
  }

  /** A read: release-v2 runs it as a strong view. */
  async view<T = unknown>(params: { contextId: string; method: string; argsJson?: Record<string, unknown> }): Promise<T> {
    try {
      const out = await this.mero.client.view(params.contextId, params.method, params.argsJson ?? {});
      return out.result as T;
    } catch (err) {
      if (err instanceof CalimeroError && (err.code === 'APP_ERROR' || err.code === 'TRAP')) {
        const detail = (err.details as Json)?.error;
        throw new RpcError(-32000, typeof detail === 'string' ? detail : JSON.stringify(detail), detail);
      }
      throw asHttpError(err, `${this.mero.baseUrl}/apps/${params.contextId}/views`);
    }
  }
}

// ---------------------------------------------------------------- events

type Handler = (event: Json) => void;

/**
 * v1's `SseClient`, over each subscribed context's committed event stream.
 *
 * An event arrives as v1's `{ contextId, type: 'StateMutation', data: { events } }`
 * so `useSubscription` callbacks keep working: one per committed entry that
 * emitted, with the app's events inside.
 */
export class CloudEvents {
  private readonly handlers = { connect: new Set<Handler>(), event: new Set<Handler>(), error: new Set<Handler>() };
  private readonly streams = new Map<string, AbortController>();
  private readonly cursor = new Map<string, number>();
  private readonly seen = new Map<string, number>();
  private readonly migration = new Set<Handler>();
  private readonly version = new Set<Handler>();
  constructor(private readonly mero: CloudMero) {}

  on(event: 'connect' | 'event' | 'error', handler: Handler): void {
    this.handlers[event].add(handler);
  }
  off(event: 'connect' | 'event' | 'error', handler: Handler): void {
    this.handlers[event].delete(handler);
  }
  onAppVersionChanged(handler: Handler): () => void {
    this.version.add(handler);
    return () => this.version.delete(handler);
  }
  onMigrationEvent(handler: Handler): () => void {
    this.migration.add(handler);
    return () => this.migration.delete(handler);
  }

  async connect(): Promise<void> {
    for (const h of this.handlers.connect) h(undefined);
  }

  /** Follow these contexts (group subscriptions have no stream on release-v2: membership is read fresh). */
  async subscribe(input: string[] | { contextIds?: string[]; groupIds?: string[] }): Promise<void> {
    const ids = Array.isArray(input) ? input : (input.contextIds ?? []);
    for (const id of ids) if (!this.streams.has(id)) this.follow(id);
  }

  async unsubscribe(input: string[] | { contextIds?: string[] }): Promise<void> {
    const ids = Array.isArray(input) ? input : (input.contextIds ?? []);
    for (const id of ids) {
      this.streams.get(id)?.abort();
      this.streams.delete(id);
    }
  }

  private follow(contextId: string): void {
    const stop = new AbortController();
    this.streams.set(contextId, stop);
    void (async () => {
      let delay = 500;
      while (!stop.signal.aborted) {
        try {
          // The first stream starts at the head (v1 delivered only what came
          // after subscribing); a reconnect resumes after the last event seen.
          const last = this.cursor.get(contextId);
          const from = last === undefined ? Number.MAX_SAFE_INTEGER : last;
          for await (const e of this.mero.client.events(contextId, from, stop.signal)) {
            delay = 500;
            const [index, seq] = e.id.split(':').map(Number);
            const at = (index ?? 0) * 1_000_000 + (seq ?? 0);
            if (last !== undefined && at <= (this.seen.get(contextId) ?? -1)) continue;
            this.seen.set(contextId, at);
            this.cursor.set(contextId, index ?? 0);
            this.emit(contextId, e);
          }
        } catch (err) {
          if (stop.signal.aborted) return;
          for (const h of this.handlers.error) h(asHttpError(err, `${this.mero.baseUrl}/apps/${contextId}/events`));
        }
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 15_000);
      }
    })();
  }

  /** v1's `StateMutation`: the app's event, its payload as the bytes of its JSON. */
  private emit(contextId: string, e: { id: string; kind: string; data: unknown }): void {
    const payload = typeof e.data === 'string' ? e.data : JSON.stringify(e.data ?? null);
    const event = {
      contextId,
      type: 'StateMutation',
      data: { events: [{ kind: e.kind, data: [...new TextEncoder().encode(payload)] }], newRoot: e.id },
    };
    for (const h of this.handlers.event) h(event);
  }

  close(): void {
    for (const stop of this.streams.values()) stop.abort();
    this.streams.clear();
  }
}

// ---------------------------------------------------------------- ephemeral

/**
 * v1's ephemeral channel (presence, cursors, typing): peers broadcast short-lived
 * values that are never stored.
 *
 * release-v2 has no such channel yet, so this keeps the API and the local half:
 * a value set here is seen by this tab and by other tabs of this browser
 * (BroadcastChannel), not by other people. Apps keep working; presence shows
 * only you until the cluster grows the channel.
 */
export class LocalEphemeral {
  readonly supported = false;
  private readonly channel: BroadcastChannel | null;
  private readonly listeners = new Map<string, Set<(entry: Json) => void>>();
  private readonly states = new Map<string, Map<string, { state: unknown; at: number }>>();

  constructor(private readonly mero: CloudMero) {
    this.channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('calimero-cloud:ephemeral');
    this.channel?.addEventListener('message', (m) => {
      const { contextId, author, state } = m.data ?? {};
      if (typeof contextId === 'string' && typeof author === 'string') this.store(contextId, author, state);
    });
  }

  private store(contextId: string, author: string, state: unknown): void {
    const map = this.states.get(contextId) ?? new Map();
    this.states.set(contextId, map);
    if (state === undefined) map.delete(author);
    else map.set(author, { state, at: Date.now() });
    for (const l of this.listeners.get(contextId) ?? []) l({ author, state, removed: state === undefined });
  }

  /** Publish this person's state for a context (v1: `ephemeral.set(contextId, value, codec)`). */
  async set(contextId: string, state: unknown, _codec?: unknown): Promise<void> {
    const author = await this.mero.accountId();
    this.store(contextId, author, state);
    this.channel?.postMessage({ contextId, author, state });
  }

  /** Every author's latest state: a replay of what is known, then each change. */
  subscribe(contextId: string, listener: (entry: Json) => void, _codec?: unknown): () => void {
    const set = this.listeners.get(contextId) ?? new Set();
    this.listeners.set(contextId, set);
    set.add(listener);
    for (const [author, { state, at }] of this.states.get(contextId) ?? []) {
      listener({ author, state, ageMs: Date.now() - at });
    }
    return () => set.delete(listener);
  }
}

// ---------------------------------------------------------------- invitations

/**
 * v1 links carried a signed open invitation; release-v2 issues a token. The
 * token travels inside v1's shape so an app's own link codec, and every
 * `invitation.invitation.group_id` an app reads, keep working.
 */
export function invitationOf(token: string, groupId: string, expiresAt = 0): Json {
  return {
    invitation: {
      group_id: groupId,
      groupId,
      inviter_identity: '',
      expiration_timestamp: expiresAt,
      cloud_token: token,
      admitters: [],
    },
    inviter_signature: 'calimero-cloud',
    admitter_addrs: [],
  };
}

export function tokenOf(invitation: Json): string {
  const inner = invitation?.invitation ?? invitation;
  const token = inner?.cloud_token ?? inner?.token ?? (typeof invitation === 'string' ? invitation : undefined);
  if (typeof token !== 'string' || !token) {
    throw new HTTPError(400, 'Bad Request', '', new Headers(), JSON.stringify({ error: 'invalid invitation: it is not a Calimero Cloud invitation' }));
  }
  return token;
}

// ---------------------------------------------------------------- packages

/**
 * An application id that names a signed package rather than one bundle:
 * `package:<name>` (any version the cluster has) or `package:<name>@<version>`.
 * The cluster verifies a package's publisher signature when it installs it and
 * each node verifies it again when it runs it, so this is what a production
 * page creates its apps from; a raw bundle hash is for development clusters.
 */
export const PACKAGE_PREFIX = 'package:';

export function packageApplicationId(name: string, version?: string): string {
  return `${PACKAGE_PREFIX}${name}${version ? `@${version}` : ''}`;
}

export function parsePackageApplicationId(id: string | null | undefined): { name: string; version?: string } | null {
  if (!id || !id.startsWith(PACKAGE_PREFIX)) return null;
  const rest = id.slice(PACKAGE_PREFIX.length);
  const at = rest.lastIndexOf('@');
  return at > 0 ? { name: rest.slice(0, at), version: rest.slice(at + 1) } : { name: rest };
}

/** What an app instance runs, as an application id: its package, else its bundle. */
function applicationIdOfApp(a: Json): string {
  return a.package ? packageApplicationId(a.package) : a.bundle;
}

/** Whether an app instance runs `applicationId` (a package matches any version). */
function runs(a: Json, applicationId: string): boolean {
  const pkg = parsePackageApplicationId(applicationId);
  return pkg ? a.package === pkg.name && (!pkg.version || a.version === pkg.version) : a.bundle === applicationId;
}

/** The newest version the registry lists for `pkg` (v1's registry API). */
export async function latestRegistryVersion(registryUrl: string, pkg: string): Promise<string> {
  const url = `${registryUrl.replace(/\/+$/, '')}/api/v2/bundles?package=${encodeURIComponent(pkg)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`the registry has no ${pkg} (HTTP ${response.status})`);
  const listed = (await response.json()) as Json[];
  const live = (Array.isArray(listed) ? listed : []).filter((b) => !b.yanked && typeof b.appVersion === 'string');
  const latest = live.reduce<Json>((best, b) => (!best || compareSemver(b.appVersion, best.appVersion) > 0 ? b : best), null);
  if (!latest) throw new Error(`the registry lists no version of ${pkg}`);
  return latest.appVersion as string;
}

export const DEFAULT_REGISTRY_URL = 'https://apps.calimero.network';

/**
 * Make `pkg` available on the cluster: a version it holds already, or
 * `version` (else the registry's newest) installed from the cluster's
 * registry, which every node verifies. Answers the package's application id.
 */
export async function ensurePackage(mero: CloudMero, pkg: string, version?: string, registryUrl = DEFAULT_REGISTRY_URL): Promise<string> {
  const held = await mero.get<Json>(`packages/${encodeURIComponent(pkg)}`).catch((err) => {
    if ((err as Json)?.status === 404) return null;
    throw err;
  });
  const versions: string[] = (held?.versions ?? []).map((v: Json) => v.version);
  if (held && (!version || versions.includes(version))) return packageApplicationId(pkg, version);
  const want = version ?? (await latestRegistryVersion(registryUrl, pkg));
  await mero.post('packages/install', { package: pkg, version: want });
  return packageApplicationId(pkg, version);
}

// ---------------------------------------------------------------- admin

const ROLE_TO_V1: Record<string, string> = { owner: 'Admin', admin: 'Admin', member: 'Member', guest: 'ReadOnly' };
const TEAM_ROLE_TO_V1: Record<string, string> = { lead: 'Admin', member: 'Member', readOnly: 'ReadOnly' };
function orgRole(v1: string): string {
  const r = v1.toLowerCase();
  return r === 'admin' ? 'admin' : r === 'readonly' || r === 'read_only' || r === 'guest' ? 'guest' : 'member';
}
function teamRole(v1: string): string {
  const r = v1.toLowerCase();
  return r === 'admin' ? 'lead' : r === 'readonly' || r === 'read_only' ? 'readOnly' : 'member';
}

function utf8(bytes: number[] | Uint8Array | undefined): unknown {
  if (!bytes || bytes.length === 0) return null;
  const text = new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function metadataRecord(meta: Json, fallbackName: string | null = null): Json {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return fallbackName === null ? null : { name: fallbackName, data: {}, updatedAt: 0, updatedBy: '' };
  }
  return {
    name: typeof meta.name === 'string' ? meta.name : fallbackName,
    data: meta.data && typeof meta.data === 'object' ? meta.data : {},
    updatedAt: typeof meta.updatedAt === 'number' ? meta.updatedAt : 0,
    updatedBy: typeof meta.updatedBy === 'string' ? meta.updatedBy : '',
  };
}

/**
 * v1's admin API over release-v2's organizations, teams and apps.
 *
 * Method for method what the apps call; anything else answers
 * {@link NotOnCloudError} through the proxy in {@link createCloudAdmin}.
 */
export class CloudAdmin {
  constructor(private readonly mero: CloudMero) {}

  private async org(org: string): Promise<Json> {
    return this.mero.get(`orgs/${org}`);
  }
  private async team(org: string, team: string): Promise<Json> {
    return this.mero.get(`orgs/${org}/teams/${team}`);
  }
  private async apps(): Promise<Json[]> {
    const { apps } = await this.mero.get<{ apps: Json[] }>('apps');
    return Promise.all(apps.map(async (a) => ({ ...a, contextId: await contextIdOf(a.appId), applicationId: applicationIdOfApp(a) })));
  }
  private async appOf(contextId: string): Promise<Json> {
    return this.mero.get(`apps/${contextId}`);
  }

  // ------------------------------------------------ identity

  async getNodeIdentity(): Promise<Json> {
    const me = await this.mero.whoami();
    return {
      accountId: me.accountId,
      deviceId: me.passkeyId ?? null,
      publicKey: me.accountId,
      accountRootPublicKey: me.accountId,
      holdsAccountRoot: true,
      deviceCertified: true,
      deviceAgreementKey: null,
      accountNamespaceId: null,
    };
  }
  async getContextIdentitiesOwned(_contextId: string): Promise<Json> {
    return { identities: [await this.mero.accountId()] };
  }
  async getContextIdentities(contextId: string): Promise<Json> {
    return this.getContextIdentitiesOwned(contextId);
  }
  async generateContextIdentity(): Promise<Json> {
    return { publicKey: await this.mero.accountId() };
  }
  async listAccountDevices(): Promise<Json> {
    const me = await this.mero.whoami(true);
    return { devices: (me.passkeys ?? []).map((p: Json) => ({ deviceId: p.id, label: null, current: p.id === me.passkeyId })) };
  }
  async revokeAccountDevice(deviceId: string): Promise<Json> {
    return this.mero.delete(`auth/passkeys/${deviceId}`);
  }

  // ------------------------------------------------ applications

  /** Bundles this account can see in use, plus the one the page runs. */
  async listApplications(): Promise<Json> {
    const bundles = new Set((await this.apps()).map((a) => a.applicationId as string));
    const own = currentApplicationId();
    if (own) bundles.add(own);
    return { apps: [...bundles].map((id) => ({ id, blob: { bytecode: id, compiled: id }, size: 0, source: '', metadata: [] })) };
  }
  async getApplication(applicationId: string): Promise<Json> {
    return { application: { id: applicationId, blob: { bytecode: applicationId, compiled: applicationId }, size: 0, source: '', metadata: [] } };
  }
  /** Install a signed package from the cluster's registry (v1's install from the registry). */
  async installApplication(request: Json = {}): Promise<Json> {
    const pkg = request.package ?? request.packageName;
    if (!pkg) throw new NotOnCloudError('installApplication from a URL', 'install a signed package by name and version');
    const applicationId = await ensurePackage(this.mero, pkg, request.version ?? request.packageVersion, request.registryUrl);
    return { applicationId };
  }
  async installFromRegistry(pkg: string, version?: string, registryUrl?: string): Promise<Json> {
    return { applicationId: await ensurePackage(this.mero, pkg, version, registryUrl) };
  }
  async getRegistryVersions(pkg?: string): Promise<Json[]> {
    if (!pkg) return [];
    const held = await this.mero.get<Json>(`packages/${encodeURIComponent(pkg)}`).catch(() => null);
    return (held?.versions ?? []).map((v: Json) => ({ version: v.version, applicationId: packageApplicationId(pkg, v.version) }));
  }
  async uninstallApplication(applicationId: string): Promise<Json> {
    const pkg = parsePackageApplicationId(applicationId);
    if (!pkg) throw new NotOnCloudError('uninstallApplication of a raw bundle', 'only packages are installed');
    await this.mero.delete(pkg.version ? `packages/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}` : `packages/${encodeURIComponent(pkg.name)}`);
    return { applicationId };
  }
  async resolveApplicationId(): Promise<string | null> {
    return currentApplicationId();
  }

  // ------------------------------------------------ namespaces (organizations)

  private async namespace(o: Json, apps: Json[]): Promise<Json> {
    const mine = apps.filter((a) => a.org === o.orgId);
    return {
      namespaceId: o.orgId,
      appKey: o.orgId,
      targetApplicationId: mine[0]?.applicationId ?? currentApplicationId() ?? '',
      createdAt: 0,
      name: o.name,
      memberCount: Object.keys(o.members ?? {}).length,
      contextCount: mine.length,
      subgroupCount: Object.keys(o.teams ?? {}).length,
    };
  }

  async listNamespaces(): Promise<Json[]> {
    const me = await this.mero.whoami(true);
    const apps = await this.apps();
    const orgs = await Promise.all((me.orgs ?? []).map((o: Json) => this.org(o.orgId).catch(() => null)));
    return Promise.all(orgs.filter(Boolean).map((o) => this.namespace(o, apps)));
  }

  /**
   * The organizations this application runs in, or that run nothing yet.
   *
   * An organization is not tied to one application on release-v2 (one
   * organization runs many apps), so "this app's namespaces" is those holding an
   * instance of it, plus empty ones a person just created.
   */
  async listNamespacesForApplication(applicationId: string): Promise<Json[]> {
    const apps = await this.apps();
    const all = await this.listNamespaces();
    return all.filter((n) => {
      const held = apps.filter((a) => a.org === n.namespaceId);
      return held.length === 0 || held.some((a) => runs(a, applicationId));
    });
  }
  async namespacesForApplication(applicationId: string): Promise<Json[]> {
    return this.listNamespacesForApplication(applicationId);
  }
  async getNamespace(namespaceId: string): Promise<Json> {
    return this.namespace(await this.org(namespaceId), await this.apps());
  }
  async createNamespace(request: { applicationId?: string; name?: string }): Promise<Json> {
    const { orgId } = await this.mero.post<{ orgId: string }>('orgs', { name: request.name ?? 'Workspace' });
    this.mero.whoami(true).catch(() => undefined);
    return { namespaceId: orgId };
  }
  async deleteNamespace(namespaceId: string): Promise<Json> {
    try {
      await this.mero.delete(`orgs/${namespaceId}`);
      return { isDeleted: true };
    } catch (err) {
      if ((err as Json)?.status === 404 || (err as Json)?.status === 405) throw new NotOnCloudError('deleteNamespace', 'organizations cannot be deleted yet');
      throw err;
    }
  }
  async leaveNamespace(namespaceId: string): Promise<Json> {
    await this.mero.delete(`orgs/${namespaceId}/members/${await this.mero.accountId()}`);
    return { left: true };
  }
  async createNamespaceInvitation(namespaceId: string, request: { expirationTimestamp?: number; recursive?: boolean } = {}): Promise<Json> {
    const ttl = request.expirationTimestamp ? Math.max(60, request.expirationTimestamp - Math.floor(Date.now() / 1000)) : undefined;
    const { token } = await this.mero.post<{ token: string }>(`orgs/${namespaceId}/invites`, { role: 'member', teams: [], ttlSecs: ttl });
    const invitation = invitationOf(token, namespaceId, request.expirationTimestamp ?? 0);
    if (request.recursive) return { invitations: [{ groupId: namespaceId, invitation }] };
    return { invitation };
  }
  async joinNamespace(namespaceId: string, request: { invitation: Json }): Promise<Json> {
    await this.mero.post(`invites/${encodeURIComponent(tokenOf(request.invitation))}/redeem`);
    const accountId = await this.mero.accountId();
    this.mero.whoami(true).catch(() => undefined);
    return { namespaceId, groupId: namespaceId, memberIdentity: accountId, memberAccount: accountId };
  }
  /** v1's one-call join with an outcome; the same classification of failures. */
  async redeemInvitation(namespaceId: string, invitation: Json, _options: Json = {}): Promise<Json> {
    return redeemParsedInvitation(
      { namespaceId, invitation },
      {
        join: (ns: string, inv: Json) => this.joinNamespace(ns, { invitation: inv }),
        memberships: async () => ((await this.mero.whoami(true)).orgs ?? []).map((o: Json) => o.orgId),
      },
    );
  }

  // ------------------------------------------------ groups (the organization, or a team)

  async listGroupMembers(groupId: string): Promise<Json> {
    const { org, team } = parseGroupId(groupId);
    let members: Json[];
    if (team) {
      const t = await this.team(org, team);
      members = (t.members ?? []).map((m: Json) => ({ identity: m.account, role: TEAM_ROLE_TO_V1[m.role] ?? 'Member' }));
    } else {
      const o = await this.org(org);
      members = Object.entries(o.members ?? {}).map(([identity, role]) => ({ identity, role: ROLE_TO_V1[role as string] ?? 'Member' }));
    }
    return { members, data: members };
  }
  async addGroupMembers(groupId: string, request: { members: Array<{ identity: string; role?: string }> }): Promise<void> {
    const { org, team } = parseGroupId(groupId);
    for (const m of request.members) {
      if (team) await this.mero.post(`orgs/${org}/teams/${team}/members`, { account: m.identity, role: teamRole(m.role ?? 'Member') });
      else await this.mero.post(`orgs/${org}/members`, { account: m.identity, role: orgRole(m.role ?? 'Member') });
    }
  }
  async removeGroupMembers(groupId: string, request: { members: string[] }): Promise<void> {
    const { org, team } = parseGroupId(groupId);
    for (const account of request.members) {
      if (team) await this.mero.delete(`orgs/${org}/teams/${team}/members/${account}`);
      else await this.mero.delete(`orgs/${org}/members/${account}`);
    }
  }
  async updateMemberRole(groupId: string, identity: string, request: { role: string }): Promise<void> {
    const { org, team } = parseGroupId(groupId);
    if (team) await this.mero.post(`orgs/${org}/teams/${team}/members`, { account: identity, role: teamRole(request.role) });
    else await this.mero.post(`orgs/${org}/members`, { account: identity, role: orgRole(request.role) });
  }
  async getMemberCapabilities(groupId: string, identity: string): Promise<Json> {
    const { org, team } = parseGroupId(groupId);
    const o = await this.org(org);
    if (team) {
      const t = await this.team(org, team);
      const row = (t.members ?? []).find((m: Json) => m.account === identity);
      if (row && typeof row.capabilities === 'number') return { capabilities: row.capabilities };
    }
    return { capabilities: o.capabilities?.[identity] ?? o.defaultCapabilities ?? 0 };
  }
  async setMemberCapabilities(groupId: string, identity: string, request: { capabilities: number }): Promise<void> {
    const { org, team } = parseGroupId(groupId);
    await this.mero.post(`orgs/${org}/capabilities`, { account: identity, team: team ?? undefined, capabilities: request.capabilities });
  }
  async getDefaultCapabilities(groupId: string): Promise<Json> {
    const o = await this.org(parseGroupId(groupId).org);
    return { defaultCapabilities: o.defaultCapabilities ?? 0 };
  }
  /** release-v2 keeps one default per organization; a team's default is its organization's. */
  async setDefaultCapabilities(groupId: string, request: { defaultCapabilities: number }): Promise<void> {
    await this.mero.post(`orgs/${parseGroupId(groupId).org}/capabilities`, { capabilities: request.defaultCapabilities });
  }

  async getGroupInfo(groupId: string): Promise<Json> {
    const { org, team } = parseGroupId(groupId);
    const o = await this.org(org);
    const apps = (await this.apps()).filter((a) => a.org === org);
    const t = team ? await this.team(org, team) : null;
    const visibility = t ? (t.join === 'everyone' ? 'open' : 'restricted') : 'restricted';
    return {
      groupId,
      appKey: org,
      targetApplicationId: apps[0]?.applicationId ?? currentApplicationId() ?? '',
      memberCount: t ? (t.members ?? []).length : Object.keys(o.members ?? {}).length,
      contextCount: t ? (t.apps ?? []).length : apps.length,
      defaultCapabilities: o.defaultCapabilities ?? 0,
      subgroupVisibility: visibility,
      effectiveVisibility: visibility,
      metadata: t ? metadataRecord(t.metadata, t.name) : metadataRecord(null, o.name),
      namespaceId: org,
    };
  }
  async syncGroup(groupId: string): Promise<Json> {
    const info = await this.getGroupInfo(groupId);
    return { groupId, appKey: info.appKey, targetApplicationId: info.targetApplicationId, memberCount: info.memberCount, contextCount: info.contextCount };
  }
  async getGroupMetadata(groupId: string): Promise<Json> {
    const { org, team } = parseGroupId(groupId);
    if (!team) return metadataRecord(null, (await this.org(org)).name);
    const t = await this.team(org, team);
    return metadataRecord(t.metadata, t.name);
  }
  async setGroupMetadata(groupId: string, request: { name?: string | null; data?: Record<string, string> }): Promise<void> {
    const { org, team } = parseGroupId(groupId);
    if (!team) throw new NotOnCloudError('setGroupMetadata on a namespace', 'an organization keeps no metadata yet; set it on a team');
    const me = await this.mero.accountId();
    await this.mero.post(`orgs/${org}/teams/${team}`, {
      name: request.name ?? undefined,
      metadata: { name: request.name ?? null, data: request.data ?? {}, updatedAt: Date.now(), updatedBy: me },
    });
  }
  async setSubgroupVisibility(groupId: string, request: { subgroupVisibility: string }): Promise<void> {
    const { org, team } = parseGroupId(groupId);
    if (!team) throw new NotOnCloudError('setSubgroupVisibility on a namespace', 'an organization is always invite-only');
    await this.mero.post(`orgs/${org}/teams/${team}`, { join: request.subgroupVisibility === 'open' ? 'everyone' : 'invite' });
  }
  async getSubgroupVisibility(groupId: string): Promise<Json> {
    const info = await this.getGroupInfo(groupId);
    return { subgroupVisibility: info.subgroupVisibility };
  }
  async setGroupOpen(groupId: string, open: boolean): Promise<void> {
    await this.setSubgroupVisibility(groupId, { subgroupVisibility: open ? 'open' : 'restricted' });
  }

  async createGroupInNamespace(namespaceId: string, request: { groupName?: string; visibility?: 'open' | 'restricted'; parentGroupId?: string } = {}): Promise<Json> {
    const parent = request.parentGroupId ? parseGroupId(request.parentGroupId).team : null;
    const { teamId } = await this.mero.post<{ teamId: string }>(`orgs/${namespaceId}/teams`, {
      name: request.groupName ?? 'Group',
      join: request.visibility === 'open' ? 'everyone' : 'invite',
      parent: parent ?? undefined,
    });
    return { groupId: groupIdOf(namespaceId, teamId) };
  }
  async createOpenGroup(namespaceId: string, request: Json = {}): Promise<Json> {
    return this.createGroupInNamespace(namespaceId, { ...request, visibility: 'open' });
  }
  async deleteGroup(groupId: string): Promise<Json> {
    const { org, team } = parseGroupId(groupId);
    if (!team) return this.deleteNamespace(org);
    await this.mero.delete(`orgs/${org}/teams/${team}`);
    return { isDeleted: true };
  }
  async reparentGroup(groupId: string, request: { newParentId: string }): Promise<void> {
    const { org, team } = parseGroupId(groupId);
    if (!team) throw new NotOnCloudError('reparentGroup on a namespace');
    const parent = parseGroupId(request.newParentId).team;
    await this.mero.post(`orgs/${org}/teams/${team}`, { parent });
  }
  async listSubgroups(groupId: string): Promise<Json[]> {
    const { org, team } = parseGroupId(groupId);
    const o = await this.org(org);
    return Object.values(o.teams ?? {})
      .filter((t: Json) => (t.parent ?? null) === team)
      .map((t: Json) => ({ groupId: groupIdOf(org, t.teamId), name: t.name }));
  }
  async listNamespaceGroups(namespaceId: string): Promise<Json[]> {
    const o = await this.org(namespaceId);
    return Object.values(o.teams ?? {}).map((t: Json) => ({ groupId: groupIdOf(namespaceId, t.teamId), name: t.name }));
  }
  async namespaceGroups(namespaceId: string): Promise<Json[]> {
    return this.listNamespaceGroups(namespaceId);
  }
  async joinGroup(request: { invitation: Json }): Promise<Json> {
    const groupId = request.invitation?.invitation?.group_id ?? '';
    await this.mero.post(`invites/${encodeURIComponent(tokenOf(request.invitation))}/redeem`);
    const accountId = await this.mero.accountId();
    return { groupId, memberIdentity: accountId, memberAccount: accountId };
  }
  async createGroupInvitation(groupId: string, request: { expirationTimestamp?: number } = {}): Promise<Json> {
    const { org, team } = parseGroupId(groupId);
    const { token } = await this.mero.post<{ token: string }>(`orgs/${org}/invites`, { role: 'member', teams: team ? [team] : [] });
    return { invitation: invitationOf(token, groupId, request.expirationTimestamp ?? 0) };
  }
  /** An open team is reached through its parent: nothing to sign. */
  async joinSubgroupInheritance(groupId: string): Promise<Json> {
    return { groupId, memberPublicKey: await this.mero.accountId(), wasInherited: true };
  }
  async leaveGroup(groupId: string): Promise<Json> {
    const { org, team } = parseGroupId(groupId);
    const me = await this.mero.accountId();
    if (team) await this.mero.delete(`orgs/${org}/teams/${team}/members/${me}`);
    else await this.mero.delete(`orgs/${org}/members/${me}`);
    return { left: true };
  }
  async groupVisibility(groupId: string): Promise<Json> {
    return this.getSubgroupVisibility(groupId);
  }

  // ------------------------------------------------ contexts (app instances)

  async createContext(request: { applicationId: string; groupId: string; name?: string; initializationParams?: number[]; serviceName?: string }): Promise<Json> {
    const { org, team } = parseGroupId(request.groupId);
    const applicationId = request.applicationId || currentApplicationId();
    if (!applicationId) throw new NotOnCloudError('createContext without an application', 'this page names no package (MeroProvider packageName) or development bundle (VITE_CALIMERO_BUNDLE)');
    const pkg = parsePackageApplicationId(applicationId);
    const { appId } = await this.mero.post<{ appId: string }>('apps', {
      name: request.name ?? request.serviceName ?? 'app',
      ...(pkg ? { package: pkg.name, version: pkg.version, service: request.serviceName } : { bundle: applicationId }),
      org,
      access: team ? { kind: 'team', team } : { kind: 'org' },
      initArgs: utf8(request.initializationParams),
    });
    return { contextId: await contextIdOf(appId), memberPublicKey: await this.mero.accountId(), groupId: request.groupId, groupCreated: false };
  }
  /** A member of the organization (or team) reaches its apps already. */
  async joinContext(contextId: string): Promise<Json> {
    await this.appOf(contextId);
    return { contextId, memberPublicKey: await this.mero.accountId() };
  }
  async leaveContext(contextId: string): Promise<Json> {
    throw new NotOnCloudError(`leaveContext(${contextId})`, 'an app is reached through its organization or team; leave that instead');
  }
  async deleteContext(contextId: string): Promise<Json> {
    await this.mero.delete(`apps/${contextId}`);
    return { isDeleted: true };
  }
  async getContext(contextId: string): Promise<Json> {
    // The listing names a packaged app's package; the record holds only its bundle.
    const listed = (await this.apps()).find((x) => x.contextId === contextId || x.appId === contextId);
    const a = listed ?? (await this.appOf(contextId));
    return { id: await contextIdOf(a.appId), applicationId: applicationIdOfApp(a), contextStateHash: '', name: a.name };
  }
  async getContexts(): Promise<Json> {
    const apps = await this.apps();
    return {
      contexts: apps.map((a) => ({ id: a.contextId, applicationId: a.applicationId, contextStateHash: '', groupId: a.org ?? null, name: a.name })),
    };
  }
  async listContexts(): Promise<Json> {
    return this.getContexts();
  }
  async getContextsForApplication(applicationId: string): Promise<Json> {
    const { contexts } = await this.getContexts();
    const pkg = parsePackageApplicationId(applicationId);
    return { contexts: contexts.filter((c: Json) => c.applicationId === applicationId || (pkg !== null && c.applicationId === packageApplicationId(pkg.name))) };
  }
  async listGroupContexts(groupId: string): Promise<Json[]> {
    const { org, team } = parseGroupId(groupId);
    if (team) {
      const t = await this.team(org, team);
      return (t.apps ?? []).map((a: Json) => ({ contextId: a.contextId, name: a.name }));
    }
    const apps = await this.apps();
    return apps.filter((a) => a.org === org && (a.access?.kind ?? 'org') !== 'team').map((a) => ({ contextId: a.contextId, name: a.name }));
  }
  async groupContexts(groupId: string): Promise<Json[]> {
    return this.listGroupContexts(groupId);
  }
  async getContextGroup(contextId: string): Promise<string | null> {
    const a = await this.appOf(contextId);
    if (!a.org) return null;
    return a.access?.kind === 'team' ? groupIdOf(a.org, a.access.team) : a.org;
  }
  async contextGroup(contextId: string): Promise<string | null> {
    return this.getContextGroup(contextId);
  }
  async identitiesOwned(contextId: string): Promise<Json> {
    return this.getContextIdentitiesOwned(contextId);
  }
  async syncContext(): Promise<Json> {
    return {}; // A replica serves reads at the committed state already.
  }
  async getContextMetadata(): Promise<Json> {
    return null;
  }
  async setContextMetadata(): Promise<void> {
    throw new NotOnCloudError('setContextMetadata', 'app instances keep no metadata yet');
  }
  async setMemberMetadata(): Promise<void> {
    throw new NotOnCloudError('setMemberMetadata', 'members keep no metadata yet');
  }
  async getMemberMetadata(): Promise<Json> {
    return null;
  }
  async createContextAlias(): Promise<Json> {
    throw new NotOnCloudError('createContextAlias', 'release-v2 has no aliases yet');
  }
  async queryContext(contextId: string, method: string, args: Record<string, unknown> = {}): Promise<Json> {
    return this.mero.rpc.view({ contextId, method, argsJson: args });
  }
  async upgradeGroup(groupId: string, request: { targetApplicationId: string; migrateMethod?: string }): Promise<Json> {
    const contexts = await this.listGroupContexts(groupId);
    const pkg = parsePackageApplicationId(request.targetApplicationId);
    for (const c of contexts) {
      await this.mero.post(
        `apps/${c.contextId}/upgrade`,
        pkg ? { version: pkg.version, migrate: request.migrateMethod } : { bundle: request.targetApplicationId, migrate: request.migrateMethod },
      );
    }
    return { groupId, status: 'completed', total: contexts.length, completed: contexts.length, failed: 0 };
  }
  async getGroupUpgradeStatus(): Promise<Json> {
    return null; // Upgrades run to completion before the call answers.
  }

  // ------------------------------------------------ blobs

  async uploadBlob(request: { data: Uint8Array | ArrayBuffer | Blob; contextId?: string }): Promise<Json> {
    const contextId = request.contextId ?? currentContextId();
    if (!contextId) throw new NotOnCloudError('uploadBlob without a context', 'a blob belongs to an app on release-v2');
    const bytes =
      request.data instanceof Uint8Array
        ? request.data
        : request.data instanceof ArrayBuffer
          ? new Uint8Array(request.data)
          : new Uint8Array(await request.data.arrayBuffer());
    const out = await this.mero.request(`/apps/${contextId}/blobs`, () => this.mero.client.uploadBlob(contextId, bytes));
    return { blobId: out.blobId, size: out.size, hash: out.id };
  }
  async getBlob(blobId: string, options: { contextId?: string } = {}): Promise<ArrayBuffer> {
    const contextId = options.contextId ?? currentContextId();
    if (!contextId) throw new NotOnCloudError('getBlob without a context', 'a blob belongs to an app on release-v2');
    const bytes = await this.mero.request(`/apps/${contextId}/blobs/${blobId}`, () => this.mero.client.downloadBlob(contextId, blobId));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
  async getBlobInfo(blobId: string, options: { contextId?: string } = {}): Promise<Json> {
    const data = await this.getBlob(blobId, options);
    return { blobId, size: data.byteLength };
  }
  async deleteBlob(): Promise<Json> {
    throw new NotOnCloudError('deleteBlob', 'blobs are not deleted yet');
  }

  // ------------------------------------------------ v1-only

  async setTeeAdmissionPolicy(): Promise<void> {
    throw new NotOnCloudError('setTeeAdmissionPolicy', 'the cluster is every app’s TEE');
  }
  async getTeeAdmissionPolicy(): Promise<Json> {
    return null;
  }
  async grantAuthorship(): Promise<void> {
    throw new NotOnCloudError('grantAuthorship', 'there is no delegated execution on release-v2');
  }
  async admitJoin(): Promise<Json> {
    throw new NotOnCloudError('admitJoin', 'joins are admitted by the cluster');
  }
}

/** The admin client, with every method v1 had that release-v2 lacks naming itself. */
export function createCloudAdmin(mero: CloudMero): CloudAdmin {
  const admin = new CloudAdmin(mero);
  return new Proxy(admin, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (value !== undefined || typeof prop !== 'string' || prop === 'then') return value;
      return async () => {
        throw new NotOnCloudError(prop);
      };
    },
  });
}

/** v1's class name, for code that names the type; on release-v2 it is {@link CloudAdmin}. */
export const AdminApiClient = CloudAdmin;
/** v1's client class name; on release-v2 it is {@link CloudMero}. */
export const MeroJs = CloudMero;
export const MeroClient = CloudMero;
export const SseClient = CloudEvents;

// ---------------------------------------------------------------- the page's own app

let applicationIdOverride: string | null = null;
let contextIdHint: string | null = null;

/** The bundle this page creates apps from (`VITE_CALIMERO_BUNDLE`, or set at runtime). */
export function currentApplicationId(): string | null {
  return applicationIdOverride ?? env('VITE_CALIMERO_BUNDLE') ?? null;
}
export function setCurrentApplicationId(id: string | null): void {
  applicationIdOverride = id;
}
export function currentContextId(): string | null {
  return contextIdHint;
}
export function setCurrentContextId(id: string | null): void {
  contextIdHint = id;
}

/**
 * Upload the page's own bundle (`wasmUrl`, served beside the page) and remember
 * its hash: the cluster stores a bundle once, so a repeat upload is cheap.
 */
export async function ensureBundle(mero: CloudMero, wasmUrl: string): Promise<string> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`could not load the app bundle ${wasmUrl}: HTTP ${response.status}`);
  const wasm = new Uint8Array(await response.arrayBuffer());
  const hash = await mero.request('/bundles', () => mero.client.uploadBundle(wasm));
  setCurrentApplicationId(hash);
  return hash;
}

// ---------------------------------------------------------------- v1 helpers apps import

export async function redeemInvitation(parsed: Json, redeemer: Json): Promise<Json> {
  return redeemParsedInvitation(parsed, redeemer);
}

/** v1 found nodes on this machine; the cloud is one URL. */
export const DEFAULT_LOCAL_NODE_PORTS: number[] = [];
export async function discoverLocalNodes(): Promise<Json[]> {
  return [];
}
export function localNodeUrl(): string {
  return defaultClusterUrl();
}
export function nodeEndpoint(url: string): string {
  return url;
}
export async function probeNodeHealth(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url.replace(/\/+$/, '')}/health`)).ok;
  } catch {
    return false;
  }
}

/** A v1 token store; the cloud keeps its session under `calimero-cloud:session`. */
export class LocalStorageTokenStore {
  getTokens(): Json {
    const s = readSession();
    return s ? { access_token: s.sessionToken, refresh_token: s.refreshToken, expires_at: s.expiresAt } : null;
  }
  setTokens(): void {}
  clear(): void {
    writeSession(null);
  }
}
export class MemoryTokenStore extends LocalStorageTokenStore {}

// Delegated accounts, relays, warrants and device enrolment were v1's way for
// a person without a node to reach one. On release-v2 a person is their
// passkey account and talks to the cluster directly, so these have nothing to do.
function notOnCloud(name: string, why = 'release-v2 accounts are passkeys on the cluster; there are no relays or delegated sessions'): (...args: unknown[]) => never {
  return () => {
    throw new NotOnCloudError(name, why);
  };
}
export const readDelegatedSession = (): null => null;
export const readDelegatedCredential = (): null => null;
export const saveDelegatedSession = (): void => undefined;
export const saveDelegatedCredential = (): void => undefined;
export const clearDelegatedSession = (): void => undefined;
export const clearDelegatedCredential = (): void => undefined;
export const relayForContext = (): null => null;
export const rememberRelay = (): void => undefined;
export const readPinnedRelayNodeKey = (): null => null;
export const readRelayMap = (): Record<string, string> => ({});
export const learnRelayNodeKey = async (): Promise<null> => null;
export const listDelegatedContexts = async (): Promise<Json[]> => [];
export const listDelegatedNamespaces = async (): Promise<Json[]> => [];
export const buildDelegatedClient = (): null => null;
export const createAccountAdmin = notOnCloud('createAccountAdmin');
export const createNodeAdmin = ({ admin }: { admin: Json }): Json => admin;
export const createDelegatedContext = notOnCloud('createDelegatedContext');
export const createDelegatedPrivateContext = notOnCloud('createDelegatedPrivateContext');
export const foundDelegatedNamespace = notOnCloud('foundDelegatedNamespace');
export const joinAsAccount = notOnCloud('joinAsAccount');
export const bootstrapFromInvitation = notOnCloud('bootstrapFromInvitation');
export const joinWithNode = notOnCloud('joinWithNode');
export const resolveRelayFromInvitation = notOnCloud('resolveRelayFromInvitation');
export const governRoot = notOnCloud('governRoot');
export const governGroup = notOnCloud('governGroup');
export const memberJoinedOpenOp = notOnCloud('memberJoinedOpenOp');
export const signGroupInvitation = notOnCloud('signGroupInvitation');
export const signMemberJoinOp = notOnCloud('signMemberJoinOp');
export const signDeviceCert = notOnCloud('signDeviceCert');
export const signAccountLogin = notOnCloud('signAccountLogin');
export const verifyDeviceCredential = notOnCloud('verifyDeviceCredential');
export const parseDeviceCredential = notOnCloud('parseDeviceCredential');
export const completeDeviceEnrolment = notOnCloud('completeDeviceEnrolment');
export const deviceEnrolmentUrl = notOnCloud('deviceEnrolmentUrl');
export const readEnrolmentCallback = (): null => null;
export const carryExecutorAccount = <T>(session: T): T => session;
export const accountRootFromPhrase = notOnCloud('accountRootFromPhrase');
export const accountRootFromSecret = notOnCloud('accountRootFromSecret');
export const generateAccountRoot = notOnCloud('generateAccountRoot');
export const mintDeviceId = notOnCloud('mintDeviceId');
export const pinRelayNodeKey = (): void => undefined;
export const resolveRelayNodeKey = async (): Promise<null> => null;
export const routingProofHeaders = async (): Promise<Record<string, string>> => ({});
export const createMeroClient = (): CloudMero => new CloudMero();
export const createBrowserHttpClient = notOnCloud('createBrowserHttpClient', 'use the cloud client');
export const createAuthApiClientFromHttpClient = notOnCloud('createAuthApiClientFromHttpClient', 'use the cloud client');
export const createAttestedSealedFetch = notOnCloud('createAttestedSealedFetch', 'CalimeroClient seals every request already');
export const createSignedReleaseVerifier = notOnCloud('createSignedReleaseVerifier', 'pass a quote verifier to configureCloud');
export const createLocalStorageNonceSource = notOnCloud('createLocalStorageNonceSource');
export const createMemoryNonceSource = notOnCloud('createMemoryNonceSource');
export const fetchNodeRelease = notOnCloud('fetchNodeRelease');
export const fetchNodeReleaseVersion = notOnCloud('fetchNodeReleaseVersion');
export const cloudNodeReleaseUrl = notOnCloud('cloudNodeReleaseUrl');
export const DEFAULT_RELEASE_MIRROR = '';
export const login = notOnCloud('login', 'sign in with a passkey (ConnectButton / LoginModal)');
export const buildAuthLoginUrl = notOnCloud('buildAuthLoginUrl', 'sign in with a passkey (ConnectButton / LoginModal)');
export const parseAuthCallback = (): null => null;
export const resolveApplicationIdFromRegistry = async (): Promise<Json> => {
  const applicationId = currentApplicationId();
  if (!applicationId) throw new NotOnCloudError('resolveApplicationIdFromRegistry', 'registry install is not on release-v2 yet; set VITE_CALIMERO_BUNDLE');
  return { applicationId };
};
export const applicationIdForBundle = (bundle: Json): string => bundle?.applicationId ?? bundle?.hash ?? '';
export const selectLatestBundle = <T>(bundles: T[]): T | undefined => bundles[bundles.length - 1];
export const normaliseAccount = (account: string): string => account;
export const signerFromSecret = notOnCloud('signerFromSecret');
export const compareSemver = (a: string, b: string): number => {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
};
export const HA_ACCOUNT_NOT_LINKED_MESSAGE = 'There is no high availability to link on Calimero Cloud: the cluster is always available.';
export const HA_REFUSAL_MESSAGES: Record<string, string> = {};

/** v1's cloud manager client (relay routing); nothing to route on release-v2. */
export class CloudClient {
  constructor(_options: unknown = {}) {}
  async getNamespaceRouting(): Promise<Json> {
    return { relays: [] };
  }
  async getAccountRelays(): Promise<Json[]> {
    return [];
  }
}
export class RelayClient {
  constructor() {
    throw new NotOnCloudError('RelayClient', 'there are no relays on Calimero Cloud');
  }
}

// Keep `classifyError` reachable for the React layer without a second import path.
export const classify = classifyError;
