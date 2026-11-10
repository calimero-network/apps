// The hooks the screens used from mero-react, on Calimero 1.0.
//
// Same names and return shapes as the v1 hooks they replace, so the
// components that call them did not change; underneath, every read comes
// from `OrgAdmin` (organizations and teams), every live update from the
// per-instance event and presence streams (`live.ts`).
//
// Removed with v1 (nothing on 1.0 needs them): joining a context or an open
// subgroup (an org member reaches every org-access app, a team member every
// app of the team, with nothing to join or sync first), sync status, the
// node URL login and the desktop SSO hand-off.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { CalimeroClient } from '@calimero-network/mero-js';
import { targetKey } from '@calimero-apps/connect';
import type { Session } from '@calimero-apps/passkey';
import { describeTarget, useSession } from './session';
import { OrgAdmin, type GroupMember } from './orgs';
import {
  EventHub,
  PresenceHub,
  type EventHandler,
  type SubscriptionEventData,
} from './live';

export type { GroupMember, Namespace } from './orgs';
export type { SseEventData, SubscriptionEventData } from './live';

interface Live {
  client: CalimeroClient;
  admin: OrgAdmin;
  events: EventHub;
  presence: PresenceHub;
  accountId: string;
}

/** Exported for tests, which provide a fake admin. */
export const LiveContext = createContext<Live | null>(null);

/** Builds the admin client and the live hubs for the signed-in account. */
export function CalimeroProvider({ children }: { children: ReactNode }) {
  const { session, passkey, source, sync } = useSession();
  const client = session.status === 'signed-in' ? session.client : null;
  const accountId = session.status === 'signed-in' ? session.accountId : null;
  const live = useMemo<Live | null>(() => {
    if (!client || !accountId) return null;
    return {
      client,
      accountId,
      admin: new OrgAdmin(client, accountId, passkey, source, sync),
      events: new EventHub(client),
      presence: new PresenceHub(client, accountId),
    };
  }, [client, accountId, passkey, source, sync]);
  useEffect(() => () => live?.events.close(), [live]);
  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
}

/** The live client, or null while signed out. */
export function useLive(): Live | null {
  return useContext(LiveContext);
}

export interface MeroValue {
  /** The signed-in account's client and live channels; null while signed out. */
  mero: { client: CalimeroClient; events: EventHub; ephemeral: PresenceHub } | null;
  client: CalimeroClient | null;
  admin: OrgAdmin | null;
  accountId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isOnline: boolean;
  /** Which cluster this session is on (v1: the node URL), for remembered state. */
  nodeUrl: string | null;
  /** "merod local (3 nodes)" / "Calimero Cloud <cluster>", for the top bar. */
  nodeLabel: string | null;
  logout: () => Promise<void>;
  /** The passkey session itself (`ManageInHomeLink`). */
  session: Session;
}

/** v1's `useMero()`, on the 1.0 session. */
export function useMero(): MeroValue {
  const api = useSession();
  const live = useLive();
  const isOnline = useSyncExternalStore(
    useCallback((cb: () => void) => (live ? live.events.onOnline(cb) : () => {}), [live]),
    () => (live ? live.events.online : true),
  );
  const { session } = api;
  const nodeUrl = session.status === 'signed-in' || session.status === 'signed-out' ? targetKey(session.target) : null;
  return useMemo(
    () => ({
      mero: live ? { client: live.client, events: live.events, ephemeral: live.presence } : null,
      client: live?.client ?? null,
      admin: live?.admin ?? null,
      accountId: live?.accountId ?? null,
      isAuthenticated: session.status === 'signed-in',
      isLoading: session.status === 'connecting',
      isOnline,
      nodeUrl,
      nodeLabel: session.status === 'signed-in' ? describeTarget(session.target) : null,
      logout: api.signOut,
      session,
    }),
    [live, session, isOnline, nodeUrl, api.signOut],
  );
}

// ---------------------------------------------------------------- events

/** Every event the instances in `appIds` commit, from now on. */
export function useSubscription(appIds: readonly string[], handler: EventHandler): void {
  const live = useLive();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const key = [...appIds].filter(Boolean).sort().join(',');
  useEffect(() => {
    if (!live || !key) return;
    const offs = key
      .split(',')
      .map((app) => live.events.subscribe(app, (e: SubscriptionEventData) => handlerRef.current(e)));
    return () => offs.forEach((off) => off());
  }, [live, key]);
}

/** Fires whenever an event stream (re)opens. */
export function useOnConnect(listener: () => void): void {
  const live = useLive();
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => (live ? live.events.onConnect(() => ref.current()) : undefined), [live]);
}

// ---------------------------------------------------------------- presence

export interface EphemeralResult<T> {
  peers: Map<string, T>;
  setPresence: (value: T) => void;
  ageOf: (author: string) => number | undefined;
  error: Error | null;
}

/** The presence slices in `app` (this account's own left out), and a throttled setter for ours. */
export function useEphemeral<T>(app: string | null, options: { throttleMs?: number } = {}): EphemeralResult<T> {
  const live = useLive();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!live || !app) return;
    return live.presence.watch(app, () => setTick((t) => t + 1));
  }, [live, app]);

  const raw = live && app ? live.presence.peers(app) : null;
  const peers = useMemo(() => {
    const out = new Map<string, T>();
    if (raw) for (const [author, p] of raw) out.set(author, p.value as T);
    return out;
    // `tick` is the change signal: the hub replaces the map on every event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, tick]);
  const ageOf = useCallback(
    (author: string) => {
      const at = raw?.get(author)?.at;
      return at === undefined ? undefined : Date.now() - at;
    },
    [raw],
  );

  const throttleMs = options.throttleMs ?? 0;
  const lastRef = useRef(0);
  const pendingRef = useRef<{ value: T; timer: ReturnType<typeof setTimeout> } | null>(null);
  const setPresence = useCallback(
    (value: T) => {
      if (!live || !app) return;
      const send = (v: T) => {
        lastRef.current = Date.now();
        void live.presence.set(app, v as object).catch((e: unknown) => console.warn('[presence] off', e));
      };
      const wait = lastRef.current + throttleMs - Date.now();
      if (wait <= 0) return send(value);
      if (pendingRef.current) {
        pendingRef.current.value = value;
        return;
      }
      const pending = {
        value,
        timer: setTimeout(() => {
          pendingRef.current = null;
          send(pending.value);
        }, wait),
      };
      pendingRef.current = pending;
    },
    [live, app, throttleMs],
  );
  useEffect(
    () => () => {
      if (pendingRef.current) clearTimeout(pendingRef.current.timer);
      pendingRef.current = null;
    },
    [app],
  );

  const error = live && app ? live.presence.error(app) : null;
  return { peers, setPresence, ageOf, error };
}

// ---------------------------------------------------------------- reads

/** Re-reads whenever this client writes to an org. */
function useOrgWrites(): number {
  const live = useLive();
  const [n, setN] = useState(0);
  useEffect(() => (live ? live.admin.onChange(() => setN((x) => x + 1)) : undefined), [live]);
  return n;
}

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

function useAsync<T>(run: ((admin: OrgAdmin) => Promise<T>) | null, key: string): AsyncState<T> {
  const live = useLive();
  const writes = useOrgWrites();
  const [state, setState] = useState<{ key: string; data: T | null; error: Error | null; loading: boolean }>({
    key: '',
    data: null,
    error: null,
    loading: false,
  });
  const [n, setN] = useState(0);
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const fn = runRef.current;
    if (!live || !fn) {
      setState({ key, data: null, error: null, loading: false });
      return;
    }
    let live_ = true;
    setState((s) => ({ ...s, key, loading: true, ...(s.key === key ? {} : { data: null, error: null }) }));
    fn(live.admin).then(
      (data) => live_ && setState({ key, data, error: null, loading: false }),
      (e: unknown) =>
        live_ &&
        setState((s) => ({ ...s, key, error: e instanceof Error ? e : new Error(String(e)), loading: false })),
    );
    return () => {
      live_ = false;
    };
  }, [live, key, writes, n]);
  const refetch = useCallback(async () => setN((x) => x + 1), []);
  const current = state.key === key;
  return {
    data: current ? state.data : null,
    loading: current ? state.loading : !!run && !!live,
    error: current ? state.error : null,
    refetch,
  };
}

export function useGroupMembers(groupId: string | null | undefined) {
  const { data, loading, error, refetch } = useAsync(
    groupId ? (a) => a.listGroupMembers(groupId).then((r) => r.members) : null,
    `members:${groupId ?? ''}`,
  );
  return { members: data ?? EMPTY_MEMBERS, loading, error, refetch };
}
const EMPTY_MEMBERS: GroupMember[] = [];

export function useGroupCapabilities(groupId: string | null | undefined, identity: string | null | undefined) {
  const { data, loading, error, refetch } = useAsync(
    groupId && identity ? (a) => a.getMemberCapabilities(groupId, identity).then((r) => r.capabilities) : null,
    `caps:${groupId ?? ''}:${identity ?? ''}`,
  );
  return { capabilities: data, loading, error, refetch };
}

export function useDefaultCapabilities(namespaceId: string | null | undefined) {
  const { data, loading, error, refetch } = useAsync(
    namespaceId ? (a) => a.getDefaultCapabilities(namespaceId) : null,
    `defaults:${namespaceId ?? ''}`,
  );
  return { defaultCapabilities: data, loading, error, refetch };
}

export function useMemberMetadata(namespaceId: string | null, memberId: string | null) {
  const { data, loading, error, refetch } = useAsync(
    namespaceId && memberId ? (a) => a.getMemberMetadata(namespaceId, memberId) : null,
    `meta:${namespaceId ?? ''}:${memberId ?? ''}`,
  );
  return { metadata: data, loading, error, refetch };
}

// ---------------------------------------------------------------- writes

function useAdminAction<A extends unknown[], R>(pick: (admin: OrgAdmin) => (...args: A) => Promise<R>) {
  const live = useLive();
  const [loading, setLoading] = useState(false);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const run = useCallback(
    async (...args: A): Promise<R> => {
      if (!live) throw new Error('Not signed in');
      setLoading(true);
      try {
        return await pickRef.current(live.admin).apply(live.admin, args);
      } finally {
        setLoading(false);
      }
    },
    [live],
  );
  return { run, loading };
}

export function useSetDefaultCapabilities() {
  const { run, loading } = useAdminAction((a) => a.setDefaultCapabilities);
  return { setDefaultCapabilities: run, loading };
}

export function useSetMemberMetadata() {
  const { run, loading } = useAdminAction((a) => a.setMemberMetadata);
  return { setMemberMetadata: run, loading };
}

export function useUpdateMemberRole() {
  const { run, loading } = useAdminAction((a) => a.updateMemberRole);
  return { updateMemberRole: run, loading };
}

export function useAddGroupMembers() {
  const { run, loading } = useAdminAction((a) => a.addGroupMembers);
  return { addGroupMembers: run, loading };
}

export function useRemoveGroupMembers() {
  const { run, loading } = useAdminAction((a) => a.removeGroupMembers);
  return { removeGroupMembers: run, loading };
}

export function useCreateGroupInNamespace() {
  const { run, loading } = useAdminAction((a) => a.createGroupInNamespace);
  return { createGroupInNamespace: run, loading };
}

export function useCreateContext() {
  const { run, loading } = useAdminAction((a) => a.createContext);
  return { createContext: run, loading };
}

export function useDeleteContext() {
  const { run, loading } = useAdminAction((a) => a.deleteContext);
  return { deleteContext: run, loading };
}

export function useDeleteGroup() {
  const { run, loading } = useAdminAction((a) => a.deleteGroup);
  return { deleteGroup: run, loading };
}

export function useSetSubgroupVisibility() {
  const { run, loading } = useAdminAction((a) => a.setSubgroupVisibility);
  return { setSubgroupVisibility: run, loading };
}

/**
 * v1 joined a context before a node could call it. On 1.0 the node decides who
 * reaches an instance from the org and team rows on every request, so there is
 * nothing to join: resolves at once.
 */
export function useJoinContext() {
  const joinContext = useCallback(async (_appId: string) => ({ joined: true }), []);
  return { joinContext, loading: false };
}

/**
 * v1 materialised an inherited membership of an open subgroup. On 1.0 an open
 * team's members are everyone who reaches its parent, with nothing to join.
 */
export function useJoinSubgroupInheritance() {
  const joinSubgroupInheritance = useCallback(async (_groupId: string) => undefined, []);
  return { joinSubgroupInheritance, loading: false };
}
