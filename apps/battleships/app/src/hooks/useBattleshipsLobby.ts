import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useNamespacesForApplication,
  useGroupContexts,
  useGroupMembers,
  useCreateNamespaceInvitation,
  useJoinNamespace,
  useMero,
  useNodeIdentity,
} from '@calimero-network/mero-react';
import type { GroupMember } from '@calimero-network/mero-react';
import { useNamespaceBootstrap } from './useNamespaceBootstrap';
import { embeddedLobbyName, lobbyLabel, setStoredLobbyName } from '../utils/lobbyName';
import { addKnownPlayer, embeddedInviterKey, getKnownPlayers } from '../utils/knownPlayers';
import { LobbyClient } from '../generated/lobby/LobbyClient';

const SELECTED_NS_KEY = 'battleships:selectedNamespaceId';

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
  selectedLobby: LobbyRecord | null;
  selectLobby: (namespaceId: string) => void;
  clearLobby: () => void;
  refetchLobbies: () => Promise<void>;

  createLobby: (name?: string) => Promise<string | null>;
  createLobbyLoading: boolean;
  createLobbyError: Error | null;

  namespaceId: string | null;
  groupId: string | null;
  groupLoading: boolean;

  members: GroupMember[];
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

  joinLobby: (invitationJson: string) => Promise<boolean>;
  joinLoading: boolean;

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
  const { applicationId: authApplicationId, mero, contextIdentity } = useMero();
  const applicationId = authApplicationId || ENV_APPLICATION_ID;

  // --- Namespace listing ---
  const {
    namespaces,
    loading: namespacesLoading,
    error: namespacesError,
    refetch: refetchNamespaces,
  } = useNamespacesForApplication(applicationId);

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
      if (!mero || namespaceContexts.length === 0) {
        if (!cancelled) setLobbyContextId(null);
        return;
      }
      for (const entry of namespaceContexts) {
        try {
          const ctx = await mero.admin.getContext(entry.contextId);
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
  }, [mero, contextIdsKey]);

  // Patch the lobbyContextId into the selected lobby record
  if (selectedLobby && lobbyContextId) {
    selectedLobby.lobbyContextId = lobbyContextId;
  }

  // --- Members of the namespace root group ---
  const {
    members,
    loading: membersLoading,
    refetch: refetchMembers,
  } = useGroupMembers(namespaceId);

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
  const { joinNamespace, loading: joinNamespaceLoading } = useJoinNamespace();
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
    if (!lobbyContextId || !mero) return;

    let cancelled = false;

    (async () => {
      try {
        const { identities } = await mero.admin.getContextIdentitiesOwned(lobbyContextId);
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
  }, [lobbyContextId, mero, contextIdentity]);

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
    if (result) {
      setExecutorPublicKey(result.memberPublicKey);
      setLobbyJoined(true);
      setSelectedNsId(result.namespaceId);
      persistSelectedNamespaceId(result.namespaceId);
      await refetchNamespaces();
      return result.namespaceId;
    }
    return null;
  }, [createNamespaceWithLobby, refetchNamespaces]);

  const invitePlayer = useCallback(async (_validForSeconds = 86400) => {
    if (!namespaceId) return null;
    return createNamespaceInvitation(namespaceId, { recursive: true });
  }, [namespaceId, createNamespaceInvitation]);

  const joinLobbyViaInvitation = useCallback(async (invitationJson: string): Promise<boolean> => {
    if (!mero) return false;
    try {
      const parsed = JSON.parse(invitationJson);

      // Support both single invitation and recursive invitation formats.
      // Recursive: { invitations: [{ groupId, invitation, groupAlias }, ...] }
      // Single:    { invitation: { groupId: number[], ... }, inviterSignature }
      let nsId: string | null = null;
      let invitation = parsed;
      let groupAlias: string | undefined;

      if (Array.isArray(parsed?.invitations) && parsed.invitations.length > 0) {
        const first = parsed.invitations[0];
        nsId = first.groupId;
        invitation = first.invitation;
        groupAlias = first.groupAlias || undefined;
      } else if (parsed?.invitation?.groupId) {
        const gid = parsed.invitation.groupId;
        nsId = Array.isArray(gid)
          ? gid.map((b: number) => b.toString(16).padStart(2, '0')).join('')
          : String(gid);
        groupAlias = parsed.groupAlias || undefined;
      }

      if (!nsId) {
        throw new Error('Invalid invitation: cannot determine namespace ID');
      }

      // The inviter embeds the lobby's human name beside the signed invitation,
      // so the joiner has something to render before the metadata syncs.
      const embedded = embeddedLobbyName(parsed) || groupAlias || '';
      if (embedded) setStoredLobbyName(nsId, embedded);

      // The inviter's own player key, so this node has someone to challenge
      // the moment it opens the lobby. The node will not tell it.
      const inviter = embeddedInviterKey(parsed);
      if (inviter) addKnownPlayer(nsId, inviter);

      const result = await joinNamespace(nsId, { invitation, groupName: groupAlias });

      if (result) {
        await refetchNamespaces();
        return true;
      }
      return false;
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('already')) return true;
      throw err;
    }
  }, [mero, joinNamespace, refetchNamespaces]);

  /**
   * The lobby context's identities, which is what "who can I play?" means here.
   *
   * Re-read whenever the context changes, and on the same poll as the member
   * list — someone joining the namespace gets a context identity at the moment
   * they open the lobby, not when they accept the invitation.
   */
  const [playerKeys, setPlayerKeys] = useState<string[]>([]);
  const refetchPlayerKeys = useCallback(async () => {
    if (!mero || !lobbyContextId) { setPlayerKeys([]); return; }
    try {
      const res = await mero.admin.getContextIdentities(lobbyContextId);
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
  }, [mero, lobbyContextId, namespaceId]);

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
      const client = new LobbyClient(mero, lobbyContextId, executorPublicKey);
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
        const client = new LobbyClient(mero, lobbyContextId, executorPublicKey);
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
    lobbiesLoading: namespacesLoading || contextsLoading,
    lobbiesError: namespacesError,
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

    joinLobby: joinLobbyViaInvitation,
    joinLoading: joinNamespaceLoading,

    refetchContexts,
  };
}
