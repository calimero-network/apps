import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppInfo, CalimeroClient, PasskeyProvider } from '@calimero-network/mero-js';
import type { AppSource } from '@calimero-apps/connect';

import { battleships, messageOf, type Battleships } from '../battleships';
import {
  createLobby as createLobbyApp,
  inviteLink,
  inviteToken,
  listLobbies,
  orgMembers,
  saveMemberName,
  type LobbyMember,
} from '../lobbies';

/**
 * A lobby as the screens list it. v1 named a lobby by its namespace and found
 * its lobby context inside; here a lobby IS one app instance, so both ids are
 * the instance's.
 */
export interface LobbyRecord {
  /** The lobby's app instance id (v1: the namespace id). */
  namespaceId: string;
  /** The same instance (v1: the lobby context inside the namespace). */
  lobbyContextId: string | null;
  /** The organization the lobby lives in (v1: the namespace's group). */
  org: string | null;
  alias?: string;
}

export interface UseBattleshipsLobbyReturn {
  lobbies: LobbyRecord[];
  lobbiesLoading: boolean;
  lobbiesError: Error | null;
  /** The lobby list has answered at least once. */
  lobbiesAnswered: boolean;
  selectedLobby: LobbyRecord | null;
  selectLobby: (lobbyId: string) => void;
  clearLobby: () => void;
  refetchLobbies: () => Promise<void>;

  /** Resolves with the new lobby's id; rejects with why it failed. */
  createLobby: (name?: string) => Promise<string>;
  createLobbyLoading: boolean;
  createLobbyError: Error | null;

  namespaceId: string | null;

  /** Everyone in the lobby's organization. */
  members: LobbyMember[];
  /** v1 listed TEE nodes admitted to the namespace; an org has none. */
  teeMembers: LobbyMember[];
  refetchMembers: () => Promise<void>;
  refetchPlayerKeys: () => Promise<void>;
  refetchPlayerMap: () => Promise<void>;
  /** The signed-in account. */
  selfIdentity: string | null;
  membersLoading: boolean;
  isAdmin: boolean;

  lobbyJoined: boolean;
  /** The id this account plays as: its account (v1: a context identity). */
  executorPublicKey: string | null;
  lobbyContextId: string | null;
  /** Accounts that have opened the lobby (`getPlayers`): who can be challenged. */
  playerKeys: string[];
  /** account -> the id it plays as, which is the account itself now. */
  playerByAccount: Record<string, string>;
  /** The display name an account set in the lobby's organization. */
  nameOf: (account: string) => string | undefined;
  /** Set this account's display name in the lobby's organization. */
  saveName: (name: string) => Promise<void>;

  /** An invitation link into the lobby's organization (a passkey step-up). */
  invitePlayer: () => Promise<string | null>;
  inviteLoading: boolean;

  /** The selected lobby's contract, or `null` before one is selected. */
  api: Battleships | null;
}

export interface LobbyDeps {
  client: CalimeroClient | null;
  accountId: string | null;
  source: AppSource;
  passkey: () => PasskeyProvider;
  /** Run after every request (the session store syncs a refreshed session). */
  after: () => void;
  /** Where the selection is remembered; `null` keeps it for this page only. */
  selectionKey: string | null;
}

const toRecord = (a: AppInfo): LobbyRecord => ({
  namespaceId: a.appId,
  lobbyContextId: a.appId,
  org: a.org,
  alias: a.name,
});

function readSelection(key: string | null): string | null {
  if (!key) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSelection(key: string | null, id: string | null): void {
  if (!key) return;
  try {
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  } catch {
    // storage unavailable
  }
}

const asError = (e: unknown) => (e instanceof Error ? e : new Error(messageOf(e)));

export function useBattleshipsLobby({
  client,
  accountId,
  source,
  passkey,
  after,
  selectionKey,
}: LobbyDeps): UseBattleshipsLobbyReturn {
  // ── Lobbies: the app instances this account reaches ─────────────────────────
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [lobbiesLoading, setLobbiesLoading] = useState(false);
  const [lobbiesError, setLobbiesError] = useState<Error | null>(null);
  const [lobbiesAnswered, setLobbiesAnswered] = useState(false);

  const refetchLobbies = useCallback(async () => {
    if (!client) return;
    setLobbiesLoading(true);
    try {
      setApps(await listLobbies(client, source));
      setLobbiesError(null);
      setLobbiesAnswered(true);
    } catch (e) {
      setLobbiesError(asError(e));
    } finally {
      setLobbiesLoading(false);
      after();
    }
  }, [client, source, after]);

  useEffect(() => {
    setApps([]);
    setLobbiesAnswered(false);
    void refetchLobbies();
  }, [refetchLobbies]);

  const lobbies = useMemo(() => apps.map(toRecord), [apps]);

  // ── Selection ───────────────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(() => readSelection(selectionKey));
  useEffect(() => {
    setSelectedId(readSelection(selectionKey));
  }, [selectionKey]);
  const selectedLobby = lobbies.find((l) => l.namespaceId === selectedId) ?? null;
  const namespaceId = selectedLobby?.namespaceId ?? null;
  const org = selectedLobby?.org ?? null;

  // Preselect the remembered lobby, else the first, unless the person cleared it.
  const userCleared = useRef(false);
  useEffect(() => {
    if (lobbies.length === 0 || userCleared.current) return;
    if (selectedId && lobbies.some((l) => l.namespaceId === selectedId)) return;
    setSelectedId(lobbies[0].namespaceId);
  }, [lobbies, selectedId]);

  const selectLobby = useCallback(
    (id: string) => {
      userCleared.current = false;
      setSelectedId(id);
      writeSelection(selectionKey, id);
    },
    [selectionKey],
  );

  const clearLobby = useCallback(() => {
    userCleared.current = true;
    setSelectedId(null);
    writeSelection(selectionKey, null);
  }, [selectionKey]);

  // ── The selected lobby's contract ───────────────────────────────────────────
  const api = useMemo(
    () => (client && namespaceId ? battleships(client, namespaceId, after) : null),
    [client, namespaceId, after],
  );

  // ── Members of the lobby's organization, with their names ───────────────────
  const [members, setMembers] = useState<LobbyMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const refetchMembers = useCallback(async () => {
    if (!client || !org) {
      setMembers([]);
      return;
    }
    setMembersLoading(true);
    try {
      setMembers(await orgMembers(client, org));
    } catch {
      // Not readable yet (an invitation still landing): the next poll retries.
    } finally {
      setMembersLoading(false);
      after();
    }
  }, [client, org, after]);
  useEffect(() => {
    setMembers([]);
    void refetchMembers();
  }, [refetchMembers]);

  const nameOf = useCallback(
    (account: string) => members.find((m) => m.identity === account)?.name,
    [members],
  );
  const saveName = useCallback(
    async (name: string) => {
      if (!client || !org || !accountId) return;
      try {
        await saveMemberName(client, org, accountId, name);
      } finally {
        after();
      }
      await refetchMembers();
    },
    [client, org, accountId, after, refetchMembers],
  );

  const isAdmin = accountId !== null && members.some((m) => m.identity === accountId && m.role === 'Admin');

  // ── Players: the accounts that have opened the lobby ────────────────────────
  const [playerKeys, setPlayerKeys] = useState<string[]>([]);
  const refetchPlayerKeys = useCallback(async () => {
    if (!api) {
      setPlayerKeys([]);
      return;
    }
    try {
      setPlayerKeys((await api.getPlayers()).map((p) => p.player));
    } catch {
      // The next poll retries.
    }
  }, [api]);

  // Register on every open: idempotent, and what puts this account on the
  // roster others challenge from.
  const [lobbyJoined, setLobbyJoined] = useState(false);
  useEffect(() => {
    setLobbyJoined(false);
    setPlayerKeys([]);
    if (!api) return;
    let live = true;
    (async () => {
      try {
        await api.registerPlayer();
      } catch {
        // A guest or a lobby still landing: the roster read below still runs.
      }
      if (!live) return;
      setLobbyJoined(true);
      await refetchPlayerKeys();
    })();
    return () => {
      live = false;
    };
  }, [api, refetchPlayerKeys]);

  const playerByAccount = useMemo(
    () => Object.fromEntries(playerKeys.map((k) => [k, k])),
    [playerKeys],
  );

  // ── Mutations ───────────────────────────────────────────────────────────────
  const [createLobbyLoading, setCreateLobbyLoading] = useState(false);
  const [createLobbyError, setCreateLobbyError] = useState<Error | null>(null);
  const createLobby = useCallback(
    async (name?: string) => {
      if (!client) throw new Error('Not signed in');
      setCreateLobbyLoading(true);
      setCreateLobbyError(null);
      try {
        const { appId } = await createLobbyApp(client, source, name?.trim() || 'lobby');
        userCleared.current = false;
        setSelectedId(appId);
        writeSelection(selectionKey, appId);
        await refetchLobbies();
        return appId;
      } catch (e) {
        const err = asError(e);
        setCreateLobbyError(err);
        throw err;
      } finally {
        setCreateLobbyLoading(false);
        after();
      }
    },
    [client, source, selectionKey, refetchLobbies, after],
  );

  const [inviteLoading, setInviteLoading] = useState(false);
  const invitePlayer = useCallback(async () => {
    if (!client || !org || !namespaceId) return null;
    setInviteLoading(true);
    try {
      return inviteLink(await inviteToken(client, org, passkey()), namespaceId, window.location, org);
    } finally {
      setInviteLoading(false);
      after();
    }
  }, [client, org, namespaceId, passkey, after]);

  return {
    lobbies,
    lobbiesLoading: lobbiesLoading && !lobbiesAnswered,
    lobbiesError,
    lobbiesAnswered,
    selectedLobby,
    selectLobby,
    clearLobby,
    refetchLobbies,

    createLobby,
    createLobbyLoading,
    createLobbyError,

    namespaceId,

    members,
    teeMembers: [],
    refetchMembers,
    refetchPlayerKeys,
    refetchPlayerMap: refetchPlayerKeys,
    selfIdentity: accountId,
    membersLoading,
    isAdmin,

    lobbyJoined,
    executorPublicKey: accountId,
    lobbyContextId: namespaceId,
    playerKeys,
    playerByAccount,
    nameOf,
    saveName,

    invitePlayer,
    inviteLoading,

    api,
  };
}
