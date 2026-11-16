import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppInfo, CalimeroClient } from '@calimero-network/mero-js';
import type { AppSource } from '@calimero-apps/connect';
import { useInstanceRelease } from '@calimero-apps/passkey';

import { lobby, messageOf, type Lobby } from '../battleships';
import {
  createLobby as createLobbyApp,
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

  /** Finishes a lobby whose organization the node approved: its app instance, your name in it. Rejects with why it failed. */
  lobbyCreated: (created: { orgId: string; name: string; selfName: string }) => Promise<string>;

  namespaceId: string | null;

  /** Everyone in the lobby's organization. */
  members: LobbyMember[];
  /** v1 listed TEE nodes admitted to the namespace; an org has none. */
  teeMembers: LobbyMember[];
  refetchMembers: () => Promise<void>;
  /** The players on the roster, or null when it could not be read. */
  refetchPlayerKeys: () => Promise<string[] | null>;
  refetchPlayerMap: () => Promise<string[] | null>;
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

  /** The selected lobby's contract, or `null` before one is selected. */
  api: Lobby | null;
}

export interface LobbyDeps {
  client: CalimeroClient | null;
  accountId: string | null;
  source: AppSource;
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
  // A lobby is an app instance, served the frontend of the release it runs.
  useInstanceRelease(client, namespaceId);

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
    () => (client && namespaceId ? lobby(client, namespaceId, after) : null),
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
  const refetchPlayerKeys = useCallback(async (): Promise<string[] | null> => {
    if (!api) {
      setPlayerKeys([]);
      return null;
    }
    try {
      const keys = (await api.contract.getPlayers()).map((p) => p.player);
      setPlayerKeys(keys);
      return keys;
    } catch {
      // The next poll retries.
      return null;
    }
  }, [api]);

  // On the roster others challenge from: read it once, and register only when
  // this account is not on it yet.
  const [lobbyJoined, setLobbyJoined] = useState(false);
  useEffect(() => {
    setLobbyJoined(false);
    setPlayerKeys([]);
    if (!api) return;
    let live = true;
    (async () => {
      const keys = await refetchPlayerKeys();
      if (!live) return;
      if (!accountId || !keys?.includes(accountId)) {
        try {
          await api.contract.registerPlayer();
        } catch {
          // A guest or a lobby still landing: the roster read below still runs.
        }
        if (!live) return;
        await refetchPlayerKeys();
      }
      if (live) setLobbyJoined(true);
    })();
    return () => {
      live = false;
    };
  }, [api, accountId, refetchPlayerKeys]);

  const playerByAccount = useMemo(
    () => Object.fromEntries(playerKeys.map((k) => [k, k])),
    [playerKeys],
  );

  // ── Mutations ───────────────────────────────────────────────────────────────
  const lobbyCreated = useCallback(
    async ({ orgId, name, selfName }: { orgId: string; name: string; selfName: string }) => {
      if (!client || !accountId) throw new Error('Not signed in');
      try {
        const appId = await createLobbyApp(client, source, orgId, name.trim());
        // Best effort: the lobby exists either way, and the name can be set in it.
        if (selfName.trim()) await saveMemberName(client, orgId, accountId, selfName.trim()).catch(() => {});
        userCleared.current = false;
        setSelectedId(appId);
        writeSelection(selectionKey, appId);
        await refetchLobbies();
        return appId;
      } finally {
        after();
      }
    },
    [client, accountId, source, selectionKey, refetchLobbies, after],
  );

  return {
    lobbies,
    lobbiesLoading: lobbiesLoading && !lobbiesAnswered,
    lobbiesError,
    lobbiesAnswered,
    selectedLobby,
    selectLobby,
    clearLobby,
    refetchLobbies,

    lobbyCreated,

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


    api,
  };
}
