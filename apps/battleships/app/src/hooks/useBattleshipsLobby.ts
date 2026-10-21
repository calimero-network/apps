import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useNamespacesForApplication,
  useGroupContexts,
  useGroupMembers,
  useCreateNamespaceInvitation,
  useMero,
  useNodeIdentity,
} from '@calimero-network/mero-react';
import type { GroupMember } from '@calimero-network/mero-react';
import { useNamespaceBootstrap } from './useNamespaceBootstrap';
import { lobbyLabel } from '../utils/lobbyName';
import { getKnownPlayers } from '../utils/knownPlayers';
import { LobbyClient } from '../generated/lobby/LobbyClient';

const SELECTED_NS_KEY = 'battleships:selectedNamespaceId';

/** A TEE fleet node admitted by hardware attestation (core's `ReadOnlyTee` / `RelayTee`). */
export const isTeeRole = (role: string | undefined): boolean =>
  role === 'ReadOnlyTee' || role === 'RelayTee';

/**
 * Split TEE nodes out of a group member list.
 *
 * A TEE node is a member row on the node, but not a person: kept out of
 * `members` so no roster, count or player-key fallback ever treats it as a
 * player. It used to make `playerKeyForMember` see two "other" members in a
 * two-player lobby, which left the opponent's key unresolved and hid their
 * Challenge button.
 */
export function splitTeeMembers<M extends { role: string }>(
  all: M[],
): { members: M[]; teeMembers: M[] } {
  return {
    members: all.filter((m) => !isTeeRole(m.role)),
    teeMembers: all.filter((m) => isTeeRole(m.role)),
  };
}

/**
 * Whether a list read for the current scope has answered successfully.
 *
 * mero-react's list hooks read `[]` with `loading: false` for a render after
 * every scope change, before their fetch starts, so neither an empty list nor
 * `!loading` says the list was asked. Only a loading -> settled transition
 * within the same scope does. (Same rule as mero-crm's `useAnswered`, #607.)
 */
export function useAnswered(loading: boolean, error: unknown, scope: readonly unknown[]): boolean {
  const [answered, setAnswered] = useState(false);
  const sawLoading = useRef(loading);
  useEffect(() => {
    sawLoading.current = loading;
    setAnswered(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, scope); // only a scope change resets; `loading` is read, not tracked
  useEffect(() => {
    if (loading) {
      sawLoading.current = true;
      return;
    }
    if (sawLoading.current) setAnswered(!error);
  }, [loading, error]);
  return answered;
}

export interface LobbyRecord {
  namespaceId: string;
  lobbyContextId: string | null;
  applicationId: string;
  alias?: string;
}

export interface UseBattleshipsLobbyReturn {
  lobbies: LobbyRecord[];
  lobbiesLoading: boolean;
  lobbiesError: Error | null;
  /**
   * The lobby list has answered for this app. Until it has, an empty list is
   * "not asked yet", not "no lobbies": on an account the application id it is
   * scoped by lands from the registry after sign-in.
   */
  lobbiesAnswered: boolean;
  selectedLobby: LobbyRecord | null;
  selectLobby: (namespaceId: string) => void;
  clearLobby: () => void;
  refetchLobbies: () => Promise<void>;

  /** Resolves with the new lobby's namespace id; rejects with why it failed. */
  createLobby: (name?: string) => Promise<string>;
  createLobbyLoading: boolean;
  createLobbyError: Error | null;

  namespaceId: string | null;
  groupId: string | null;
  groupLoading: boolean;

  /** People only; TEE nodes are split out into `teeMembers`. */
  members: GroupMember[];
  /** TEE nodes (`ReadOnlyTee` / `RelayTee`) admitted to the lobby's group. */
  teeMembers: GroupMember[];
  /** Re-read the member list. Someone joining emits no event we can rely on. */
  refetchMembers: () => Promise<void>;
  /** Re-read the lobby's player keys. */
  refetchPlayerKeys: () => Promise<void>;
  /** Re-read the contract's account -> player key map. */
  refetchPlayerMap: () => Promise<void>;
  selfIdentity: string | null;
  membersLoading: boolean;
  isAdmin: boolean;

  lobbyJoined: boolean;
  executorPublicKey: string | null;
  lobbyContextId: string | null;
  /**
   * Every player key in the lobby context — the ids you challenge with.
   *
   * ⚠️ NOT `members`. That list comes from the GROUP and is keyed by ACCOUNT
   * id, which `create_match` does not accept: a player is a CONTEXT member, so
   * the id it wants is the context identity. Since rc.27 both render as 64 hex,
   * so the wrong one is accepted by every shape check and fails later as
   * "not a player".
   */
  playerKeys: string[];
  /**
   * account id -> the player key that account plays as.
   *
   * Recorded in the CONTRACT by each member about itself (`register_player`),
   * because it is the only thing that reaches every node: group membership is
   * keyed by account and syncs, context identities are the player keys and do
   * NOT — a joining node lists only its own, forever. Nothing on the node
   * relates the two ids, so without this map a lobby with three members shows
   * every row as "hasn't opened the lobby yet" on EVERY node, the creator's
   * included, even though the creator holds all the keys.
   */
  playerByAccount: Record<string, string>;

  invitePlayer: (validForSeconds?: number) => Promise<unknown>;
  inviteLoading: boolean;

  refetchContexts: () => Promise<void>;
}

function loadSelectedNamespaceId(): string | null {
  try {
    return localStorage.getItem(SELECTED_NS_KEY);
  } catch {
    return null;
  }
}

function persistSelectedNamespaceId(nsId: string | null) {
  try {
    if (nsId) {
      localStorage.setItem(SELECTED_NS_KEY, nsId);
    } else {
      localStorage.removeItem(SELECTED_NS_KEY);
    }
  } catch {
    // storage unavailable
  }
}

const ENV_APPLICATION_ID = import.meta.env.VITE_APPLICATION_ID?.trim() || null;

export function useBattleshipsLobby(): UseBattleshipsLobbyReturn {
  // `admin` (the session admin) for every admin call below, never
  // `mero.admin`: on an account that is the relay's raw node client, which
  // refuses writes and answers "owned identities" with the relay's own.
  const { applicationId: authApplicationId, mero, admin, contextIdentity, isDelegated } = useMero();
  // On an account the provider's registry-derived id is the only answer, and it
  // lands after sign-in. Listing under the env id meanwhile could list nothing
  // (another build's id) and read as "no lobbies". On a node the env fallback
  // stays as it was.
  const applicationId = isDelegated
    ? authApplicationId || null
    : authApplicationId || ENV_APPLICATION_ID;

  // --- Namespace listing ---
  const {
    namespaces,
    loading: namespacesLoading,
    error: namespacesError,
    refetch: refetchNamespaces,
  } = useNamespacesForApplication(applicationId);
  const lobbiesAnswered = useAnswered(namespacesLoading, namespacesError, [admin, applicationId]);
  // Waiting on an answer that will come: a node with an app id, or an account
  // (whose id is still landing). A node with no id has nothing to list.
  const lobbiesPending =
    !lobbiesAnswered && !namespacesError && (applicationId !== null || isDelegated);

  const lobbies: LobbyRecord[] = namespaces.map((ns) => ({
    namespaceId: ns.namespaceId,
    lobbyContextId: null, // resolved below for the selected namespace
    applicationId: ns.targetApplicationId,
    // `lobbyLabel`, not `ns.name`: the JOINING node has no server-side name
    // until the namespace metadata syncs, and would otherwise show a raw id.
    alias: lobbyLabel(ns.namespaceId, ns.name),
  }));

  // --- Namespace selection ---
  const [selectedNsId, setSelectedNsId] = useState<string | null>(loadSelectedNamespaceId);
  const selectedLobby = lobbies.find((l) => l.namespaceId === selectedNsId) ?? null;
  const namespaceId = selectedLobby?.namespaceId ?? null;

  // The namespace IS the root group — groupId === namespaceId
  const groupId = namespaceId;

  // --- Derive lobby context from namespace's root group contexts ---
  const {
    contexts: namespaceContexts,
    loading: contextsLoading,
    refetch: refetchGroupContexts,
  } = useGroupContexts(namespaceId);

  const groupLoading = namespacesLoading || contextsLoading;

  /**
   * The lobby context, identified by its SERVICE — not by being first.
   *
   * ⚠️ THIS WAS `namespaceContexts[0]`, AND THAT IS WHY THE LOBBY BROKE ON
   * REFRESH. Match contexts are created in the SAME namespace root group
   * (`createContext({ groupId: namespaceId, serviceName: 'game' })`), so the
   * moment you start a game the group holds two or more contexts and
   * `listGroupContexts` has no defined order. Whenever the game context sorted
   * first, every lobby call went to it and answered `method "get_matches" not
   * found` — along with `get_history` and `get_player_stats` — and the members
   * and match list vanished. Nothing was actually lost; the app was talking to
   * the wrong context.
   *
   * `GroupContextEntry` carries only `{ contextId, alias }`, so the service is
   * not in the listing and has to be read per context. `Context.serviceName` is
   * what distinguishes them.
   */
  const [lobbyContextId, setLobbyContextId] = useState<string | null>(null);
  const contextIdsKey = namespaceContexts.map((c) => c.contextId).join(',');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!admin || namespaceContexts.length === 0) {
        if (!cancelled) setLobbyContextId(null);
        return;
      }
      for (const entry of namespaceContexts) {
        try {
          const ctx = await admin.getContext(entry.contextId);
          if (cancelled) return;
          if (ctx?.serviceName === 'lobby') {
            setLobbyContextId(entry.contextId);
            return;
          }
        } catch {
          // A context this node cannot read yet is simply not a candidate.
        }
      }
      if (cancelled) return;
      // No context claimed the lobby service. Older bundles predate
      // `serviceName`, so fall back to the previous behaviour rather than
      // leaving the app with no lobby at all — but say so, because on a bundle
      // that DOES set it this means the lobby context is missing.
      console.warn('[lobby] no context reported serviceName "lobby"; falling back to the first');
      setLobbyContextId(namespaceContexts[0]?.contextId ?? null);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, contextIdsKey]);

  // Patch the lobbyContextId into the selected lobby record
  if (selectedLobby && lobbyContextId) {
    selectedLobby.lobbyContextId = lobbyContextId;
  }

  // --- Members of the namespace root group ---
  const {
    members: groupMembers,
    loading: membersLoading,
    refetch: refetchMembers,
  } = useGroupMembers(namespaceId);
  const { members, teeMembers } = useMemo(
    () => splitTeeMembers(groupMembers ?? []),
    [groupMembers],
  );

  // ⚠️ `useGroupMembers` used to return `selfIdentity`; mero-react 6 removed it,
  // and the value it returned was the wrong id anyway. `members[].identity` is
  // keyed by ACCOUNT id (core rekeyed group members at rc.21) while the old
  // `selfIdentity` was the context public key. Both are 64 hex at rc.27+, so
  // `m.identity === selfIdentity` never matched and nothing errored: the "(you)"
  // marker never rendered, and `isAdmin` below was ALWAYS false — hiding admin
  // controls from the actual admin.
  //
  // `useNodeIdentity` takes no key, so it resolves once on mount — and on the
  // onboarding path the node has no account yet at that point, because it is
  // creating or joining the namespace that enrols it. Re-ask on every namespace
  // change or this stays null for the whole first session.
  const { identity: nodeIdentity, refetch: refetchNodeIdentity } = useNodeIdentity();
  const refetchNodeIdentityRef = useRef(refetchNodeIdentity);
  refetchNodeIdentityRef.current = refetchNodeIdentity;
  useEffect(() => {
    if (namespaceId) void refetchNodeIdentityRef.current();
  }, [namespaceId]);
  const selfIdentity = nodeIdentity?.accountId ?? null;

  // --- Mutations ---
  const { createNamespaceInvitation, loading: inviteLoading } = useCreateNamespaceInvitation();
  const {
    createNamespaceWithLobby,
    loading: createLobbyLoading,
    error: createLobbyError,
  } = useNamespaceBootstrap(applicationId);

  // --- Lobby join state ---
  const [lobbyJoined, setLobbyJoined] = useState(false);
  const [executorPublicKey, setExecutorPublicKey] = useState<string | null>(null);

  // Auto-select: pick persisted namespace if valid, or fall back to first
  const userCleared = useRef(false);

  useEffect(() => {
    if (lobbies.length === 0) return;
    if (userCleared.current) return;

    if (selectedNsId && lobbies.some((l) => l.namespaceId === selectedNsId)) return;

    const persisted = loadSelectedNamespaceId();
    const match = persisted ? lobbies.find((l) => l.namespaceId === persisted) : null;
    if (match) {
      setSelectedNsId(match.namespaceId);
      return;
    }

    setSelectedNsId(lobbies[0].namespaceId);
    persistSelectedNamespaceId(lobbies[0].namespaceId);
  }, [lobbies, selectedNsId]);

  // Reset join state when namespace changes
  useEffect(() => {
    setLobbyJoined(false);
    setExecutorPublicKey(null);
  }, [selectedNsId]);

  // Resolve executor identity from the lobby context
  useEffect(() => {
    if (!lobbyContextId || !admin) return;

    let cancelled = false;

    (async () => {
      try {
        const { identities } = await admin.getContextIdentitiesOwned(lobbyContextId);
        if (!cancelled && identities.length > 0) {
          setExecutorPublicKey(identities[0]);
          return;
        }
        if (!cancelled && contextIdentity) {
          setExecutorPublicKey(contextIdentity);
        }
      } catch {
        if (!cancelled && contextIdentity) {
          setExecutorPublicKey(contextIdentity);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [lobbyContextId, admin, contextIdentity]);

  // Mark lobby as joined once we have identity
  useEffect(() => {
    if (lobbyContextId && executorPublicKey && !lobbyJoined) {
      setLobbyJoined(true);
    }
  }, [lobbyContextId, executorPublicKey, lobbyJoined]);

  const isAdmin = selfIdentity !== null
    && members.some((m) => m.identity === selfIdentity && m.role === 'Admin');

  // --- Callbacks ---

  const selectLobby = useCallback((nsId: string) => {
    userCleared.current = false;
    setSelectedNsId(nsId);
    persistSelectedNamespaceId(nsId);
  }, []);

  const clearLobby = useCallback(() => {
    userCleared.current = true;
    setSelectedNsId(null);
    persistSelectedNamespaceId(null);
  }, []);

  const createLobby = useCallback(async (name?: string) => {
    const result = await createNamespaceWithLobby(name || 'lobby');
    setExecutorPublicKey(result.memberPublicKey);
    setLobbyJoined(true);
    setSelectedNsId(result.namespaceId);
    persistSelectedNamespaceId(result.namespaceId);
    await refetchNamespaces();
    return result.namespaceId;
  }, [createNamespaceWithLobby, refetchNamespaces]);

  const invitePlayer = useCallback(async (_validForSeconds = 86400) => {
    if (!namespaceId) return null;
    return createNamespaceInvitation(namespaceId, { recursive: true });
  }, [namespaceId, createNamespaceInvitation]);

  /**
   * The lobby context's identities, which is what "who can I play?" means here.
   *
   * Re-read whenever the context changes, and on the same poll as the member
   * list — someone joining the namespace gets a context identity at the moment
   * they open the lobby, not when they accept the invitation.
   */
  const [playerKeys, setPlayerKeys] = useState<string[]>([]);
  const refetchPlayerKeys = useCallback(async () => {
    if (!admin || !lobbyContextId) { setPlayerKeys([]); return; }
    try {
      const res = await admin.getContextIdentities(lobbyContextId);
      const fromNode = Array.isArray(res?.identities) ? res.identities : [];
      // Union with the keys learned from invitations: the node reports only
      // what IT knows, which on a joining node is just itself.
      const remembered = namespaceId ? getKnownPlayers(namespaceId) : [];
      setPlayerKeys([...new Set([...fromNode, ...remembered])]);
    } catch {
      // A context this node has not bootstrapped yet answers 404. Not an error
      // worth surfacing — the list simply is not known yet.
      setPlayerKeys([]);
    }
  }, [admin, lobbyContextId, namespaceId]);

  useEffect(() => { void refetchPlayerKeys(); }, [refetchPlayerKeys]);

  /**
   * The account -> player key mapping, read from the lobby contract.
   *
   * Folded into the same refetch as the keys so one poll refreshes both.
   * A context still running an older build has no `get_players`; that answers
   * "method not found" and is left as an empty map rather than surfaced — the
   * view falls back to the old heuristic in that case.
   */
  const [playerByAccount, setPlayerByAccount] = useState<Record<string, string>>({});
  const refetchPlayerMap = useCallback(async () => {
    if (!mero || !lobbyContextId || !executorPublicKey) { setPlayerByAccount({}); return; }
    try {
      const client = new LobbyClient(mero, lobbyContextId);
      const entries = await client.getPlayers();
      const next: Record<string, string> = {};
      for (const e of entries ?? []) {
        if (e?.account && e?.player) next[e.account] = e.player;
      }
      setPlayerByAccount(next);
    } catch {
      setPlayerByAccount({});
    }
  }, [mero, lobbyContextId, executorPublicKey]);

  useEffect(() => { void refetchPlayerMap(); }, [refetchPlayerMap]);

  /**
   * Publish this node's own account -> player key pairing.
   *
   * Runs on every lobby open rather than only on join, which is what makes it
   * self-healing: a member who joined before this existed registers the first
   * time they open the lobby, with no migration. `register_player` is a no-op
   * write when the pair is already recorded, so the repeat costs nothing.
   */
  useEffect(() => {
    if (!mero || !lobbyContextId || !executorPublicKey) return;
    let cancelled = false;
    (async () => {
      try {
        const client = new LobbyClient(mero, lobbyContextId);
        await client.registerPlayer();
        if (!cancelled) await refetchPlayerMap();
      } catch {
        // An older contract has no such method. Nothing to do; the view falls
        // back to the heuristic.
      }
    })();
    return () => { cancelled = true; };
  }, [mero, lobbyContextId, executorPublicKey, refetchPlayerMap]);

  const refetchContexts = useCallback(async () => {
    await refetchNamespaces();
    await refetchGroupContexts();
  }, [refetchNamespaces, refetchGroupContexts]);

  return {
    lobbies,
    lobbiesLoading: namespacesLoading || contextsLoading || lobbiesPending,
    lobbiesError: namespacesError,
    lobbiesAnswered,
    selectedLobby,
    selectLobby,
    clearLobby,
    refetchLobbies: refetchNamespaces,

    createLobby,
    createLobbyLoading: createLobbyLoading,
    createLobbyError: createLobbyError,

    namespaceId,
    groupId,
    groupLoading,

    members,
    teeMembers,
    refetchMembers,
    playerKeys,
    playerByAccount,
    refetchPlayerKeys,
    refetchPlayerMap,
    selfIdentity,
    membersLoading,
    isAdmin,

    lobbyJoined,
    executorPublicKey,
    lobbyContextId,

    invitePlayer,
    inviteLoading,

    refetchContexts,
  };
}
