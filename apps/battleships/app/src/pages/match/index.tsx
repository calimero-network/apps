import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { appSource, targetKey } from '@calimero-apps/connect';
import { AppListing, JoinInvitation, usePendingInvite } from '@calimero-apps/passkey';
import type { PendingInvite } from '@calimero-apps/connect';
import {
  PACKAGE,
  isMatchFinishedError,
  isShipsNotPlacedError,
  messageOf,
  base64url,
  toMatchRecord,
  toMatchSummary,
  toPlayerStats,
  type MatchRecord,
  type MatchStateView,
  type MatchSummary,
  type PlayerStatsView,
  type ShotsView,
  type WireMatchRecord,
  type WireMatchSummary,
  type WirePlayerStats,
} from '../../battleships';
import {
  cellsFromShips,
  computeCommitment,
  encodeBoardBytes,
  overlayOwnBoard,
  randomSalt,
  resolveShot,
} from '../../lib/board';
import { loadBoard, saltBytes, saltHex, saveBoard } from '../../lib/boardStore';
import type { AllGameEvents } from '../../types/events';
import { useGameSubscriptions } from '../../hooks/useGameSubscriptions';
import { useBattleshipsLobby } from '../../hooks/useBattleshipsLobby';
import { invitedLobby, inviter, listLobbies } from '../../lobbies';
import { LISTING, ONBOARDING, describeTarget, useInviteState, useSessionApi } from '../../session';
import { SHIP_TARGETS, validateFleetPayload } from './config';

import NavBar from '../../components/NavBar';
import LobbySelect from '../../components/LobbySelect';
import AppFooter from '../../components/AppFooter';
import ConnectCard from '../../components/ConnectCard';
import { useToast } from '../../contexts/ToastContext';
import { forgetLastLobby, pickResumeLobby, readLastLobby, rememberLobby } from '../../utils/lastLobby';
import LobbyView from '../../components/LobbyView';
import { formatKey, playerName } from '../../utils/playerName';
import GameBoard from '../../components/GameBoard';
import ShotGrid from '../../components/ShotGrid';
import PlacementGrid from '../../components/PlacementGrid';
import ShipSelector from '../../components/ShipSelector';

export default function MatchPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const sessionApi = useSessionApi();
  const { session, store } = sessionApi;
  const { show } = useToast();

  const client = session.status === 'signed-in' ? session.client : null;
  const accountId = session.status === 'signed-in' ? session.accountId : null;
  // Where "the lobby you had open last" is remembered: per target and account,
  // as v1 kept it per node.
  const scope = session.status === 'signed-in' ? `${targetKey(session.target)}:${session.accountId}` : null;
  const source = useMemo(() => appSource(sessionApi.env, PACKAGE), [sessionApi.env]);
  const after = useCallback(() => {
    if (client) store?.sync(client);
  }, [client, store]);

  const lobby = useBattleshipsLobby({
    client,
    accountId,
    source,
    passkey: sessionApi.passkey,
    after,
    selectionKey: scope ? `battleships:selected-lobby:${scope}` : null,
  });
  // One app instance is the lobby and every match in it.
  const lobbyApi = lobby.api;
  const { nameOf } = lobby;
  const saveName = useCallback(
    (name: string) => {
      if (!name) return;
      lobby
        .saveName(name)
        .then(() => show({ title: 'Name saved', variant: 'success' }))
        .catch(() => show({ title: 'Could not save your name', variant: 'error' }));
    },
    [lobby, show],
  );

  // View state
  const [view, setView] = useState<'lobby-select' | 'lobby' | 'game'>('lobby-select');
  const manualLobbySelect = useRef(false);

  // Lobby creation form
  const [newLobbyName, setNewLobbyName] = useState('');
  const [invitationLink, setInvitationLink] = useState<string | null>(null);

  // Match management
  const [matchId, setMatchId] = useState<string>('');
  const [player2, setPlayer2] = useState<string>('');
  const [myMatches, setMyMatches] = useState<MatchSummary[]>([]);
  const [creatingMatch, setCreatingMatch] = useState(false);
  const [playerStats, setPlayerStats] = useState<PlayerStatsView | null>(null);
  const [history, setHistory] = useState<MatchRecord[]>([]);

  // Game state
  const [size, setSize] = useState<number>(10);
  const [ownBoard, setOwnBoard] = useState<number[]>([]);
  const [shotsBoard, setShotsBoard] = useState<number[]>([]);
  const [placed, setPlaced] = useState<boolean>(false);
  /**
   * The match as the contract derives it — standing, who has committed, the
   * pending shot, who has revealed — in one read per refresh.
   */
  const [matchState, setMatchState] = useState<MatchStateView | null>(null);
  /**
   * This device holds no board for a match this player committed to: it was
   * placed on another device, or the store was cleared. Shots cannot be
   * answered from here and the board cannot be revealed from here.
   */
  const [boardMissing, setBoardMissing] = useState<boolean>(false);
  /** The opponent has not deployed yet (`getMatchState` lists who has committed). */
  const [opponentNotReady, setOpponentNotReady] = useState<boolean>(false);
  const [currentTurn, setCurrentTurn] = useState<string | null>(null);
  const [isMyTurn, setIsMyTurn] = useState<boolean>(false);
  const [pendingShot, setPendingShot] = useState<{ x: number; y: number } | null>(null);

  // Ship placement
  const [grid, setGrid] = useState<boolean[][]>(() =>
    Array.from({ length: 10 }, () => Array(10).fill(false)),
  );
  const [selectedShip, setSelectedShip] = useState<number | null>(null);
  const [shipCounts, setShipCounts] = useState<number[]>([0, 0, 0, 0]);
  const [shipTargets] = useState<number[]>([...SHIP_TARGETS]);
  const [isHorizontal, setIsHorizontal] = useState<boolean>(true);
  const [isRemovalMode, setIsRemovalMode] = useState<boolean>(false);

  // Shooting
  const [selectedShotX, setSelectedShotX] = useState<number | null>(null);
  const [selectedShotY, setSelectedShotY] = useState<number | null>(null);

  const loadingRef = useRef<boolean>(false);
  const effectiveMatchId = matchId;
  // The match runs in the lobby's own instance: ready as soon as the lobby is.
  const matchApi = view === 'game' ? (lobbyApi?.contract ?? null) : null;
  const matchApiReady = matchApi !== null;

  /** The id this player plays as, and the key the board on this device is filed under. */
  const currentUser = accountId;
  const boardOwner = accountId;

  const currentMatch = myMatches.find((m) => m.match_id === effectiveMatchId);
  // The match's own standing is read directly too: it ends on the answers
  // before a winner is recorded, and the reveal that decides it is ours to
  // make while the lobby still says Active.
  const standing = matchState?.standing ?? 'playing';
  const matchFinished = currentMatch?.status === 'Finished' || standing !== 'playing';
  const matchWinner = currentMatch?.winner ?? matchState?.winner ?? null;
  const isWinner = matchFinished && matchWinner !== null && matchWinner === currentUser;
  const awaitingReveal = standing === 'awaiting_reveal';
  const ownRevealed = Boolean(boardOwner && matchState?.revealed.includes(boardOwner));
  const auditFailed = matchState?.audit_failed ?? [];

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  // URL-driven lobby entry: `/lobby?id=<lobby>` selects that lobby and enters
  // it once its contract is ready. A bare `/lobby` stays on 'lobby-select',
  // unless the resume effect below hands it the lobby you had open last.
  useEffect(() => {
    if (view !== 'lobby-select') return;
    if (manualLobbySelect.current) return;
    const params = new URLSearchParams(location.search);
    const urlLobbyId = params.get('id');
    if (!urlLobbyId) return;
    if (lobby.selectedLobby?.namespaceId !== urlLobbyId) {
      if (lobby.lobbies.some((l) => l.namespaceId === urlLobbyId)) lobby.selectLobby(urlLobbyId);
      return;
    }
    if (lobby.selectedLobby && lobby.lobbyContextId) {
      setView('lobby');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- lobby is an object that changes every render; only the fields listed matter
  }, [view, location.search, lobby.selectedLobby, lobby.lobbies, lobby.lobbyContextId]);

  // An invitation is asked about, never redeemed on its own: "Join {inviter}'s
  // game as {account}?", with Join and Not now (`JoinInvitation`, rendered
  // below). A player already in the lobby's organization (the inviter opening
  // their own link) is told so instead: redeeming would spend the link's
  // single use. Joining opens the lobby the link named (else one in the org
  // it joined); a sign-up from the invitation page joined with the invite
  // already (`SessionProvider` sets `landing`), and its lobby opens.
  const { invites, landing, setLanding } = useInviteState();
  const pending = usePendingInvite(invites);
  // The invitation a signed-in account is asked about stays on screen until it
  // closes: `JoinInvitation` drops the token before it says "already in" or
  // "used up", and the store would take the question away with it.
  const [asked, setAsked] = useState<PendingInvite | null>(null);
  useEffect(() => {
    if (!client) setAsked(null);
    else if (pending) setAsked(pending);
  }, [client, pending]);
  const invite = client ? (pending ?? asked) : null;

  useEffect(() => {
    if (!client || !landing) return;
    setLanding(null);
    const { org, lobby: named } = landing;
    const title = landing.member ? "You're already in this lobby" : 'Invitation accepted';
    void (async () => {
      const listed = await listLobbies(client, source).catch(() => []);
      const found = (named ? listed.find((l) => l.appId === named) : undefined)
        ?? (org ? listed.find((l) => l.org === org) : undefined);
      await lobby.refetchLobbies();
      after();
      show({ title, variant: 'success' });
      if (found) {
        manualLobbySelect.current = false;
        setView('lobby-select');
        navigate(`/lobby?id=${encodeURIComponent(found.appId)}`, { replace: true });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- lobby is an object that changes every render
  }, [client, landing, setLanding, source, after, show, navigate]);

  // A bare `/lobby` — a reload, or signing in — resumes the lobby you had
  // open last, if it is still listed (see `utils/lastLobby`). Decided once
  // per visit: a `?id=` already in the URL or "All lobbies" win. A lobby no
  // longer listed is forgotten and the picker shows.
  const resumeDecided = useRef(false);
  useEffect(() => {
    if (resumeDecided.current || !scope) return;
    if (
      location.pathname !== '/lobby'
      || view !== 'lobby-select'
      || manualLobbySelect.current
      || invite
      || new URLSearchParams(location.search).get('id')
    ) {
      resumeDecided.current = true;
      return;
    }
    const remembered = readLastLobby(scope);
    if (!remembered) {
      resumeDecided.current = true;
      return;
    }
    if (!lobby.lobbiesAnswered) return;
    resumeDecided.current = true;
    const target = pickResumeLobby(lobby.lobbies.map((l) => l.namespaceId), remembered);
    if (target) {
      navigate(`/lobby?id=${encodeURIComponent(target)}`, { replace: true, state: { resume: true } });
    } else {
      forgetLastLobby(scope);
    }
  }, [view, location.pathname, location.search, lobby.lobbies, lobby.lobbiesAnswered, scope, navigate, invite]);

  // Remember the lobby once you are in it — never on the picker, where a
  // selection is only a preselection.
  useEffect(() => {
    if (view === 'lobby' && lobby.namespaceId && scope) rememberLobby(scope, lobby.namespaceId);
  }, [view, lobby.namespaceId, scope]);

  // `/match?match_id=…&id=…` opens a match (v1's links also carried a
  // `context_id`, which is ignored: the match is in the lobby's instance).
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlMatchId = params.get('match_id');
    const urlLobbyId = params.get('id');
    if (!urlMatchId || location.pathname !== '/match') return;
    if (urlLobbyId && lobby.selectedLobby?.namespaceId !== urlLobbyId) {
      if (lobby.lobbies.some((l) => l.namespaceId === urlLobbyId)) lobby.selectLobby(urlLobbyId);
      return;
    }
    setMatchId(urlMatchId);
    setView('game');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- lobby is an object that changes every render
  }, [location.pathname, location.search, lobby.selectedLobby, lobby.lobbies]);

  // ---------------------------------------------------------------------------
  // Board & turn loading
  // ---------------------------------------------------------------------------

  // The last shot this device answered, and whether a reveal is in flight: a
  // refresh can run several times while one write is still on its way, and a
  // second answer to the same shot (or a second reveal) is a refused call.
  const answeredShotRef = useRef<number | null>(null);
  const revealingRef = useRef<boolean>(false);

  /**
   * Answer the pending shot from the board on this device, if it is ours to
   * answer. Automatic: the defender never sees a prompt, the contract records
   * the answer as their signed statement, and the reveal at the end is
   * replayed against it.
   */
  const answerPendingShot = useCallback(
    async (state: MatchStateView, cells: number[]): Promise<boolean> => {
      if (!matchApi || !effectiveMatchId || !boardOwner) return false;
      const shot = state.pending_shot;
      if (!shot || shot.target !== boardOwner || state.standing !== 'playing') return false;
      if (answeredShotRef.current === shot.shot_id) return false;
      answeredShotRef.current = shot.shot_id;
      try {
        await matchApi.acknowledgeShot({
          matchId: effectiveMatchId,
          shotId: shot.shot_id,
          hit: resolveShot(cells, shot.x, shot.y, size),
        });
        return true;
      } catch (e) {
        // Let a later refresh try again — unless the answer is in, in which
        // case the next read shows no pending shot and nothing retries.
        answeredShotRef.current = null;
        console.warn('[match] acknowledgeShot failed', e);
        return false;
      }
    },
    [matchApi, effectiveMatchId, boardOwner, size],
  );

  /**
   * Open this device's board once the answers have ended the match and the
   * contract has not seen ours yet. The win is not a win until the winner's
   * board has passed the audit.
   */
  const revealIfDue = useCallback(
    async (state: MatchStateView, cells: number[], salt: Uint8Array): Promise<boolean> => {
      if (!matchApi || !effectiveMatchId || !boardOwner) return false;
      if (state.standing === 'playing' || state.revealed.includes(boardOwner)) return false;
      if (revealingRef.current) return false;
      revealingRef.current = true;
      try {
        await matchApi.revealBoard({
          matchId: effectiveMatchId,
          boardBytes: base64url(encodeBoardBytes(cells)),
          salt: base64url(salt),
        });
        return true;
      } catch (e) {
        console.warn('[match] revealBoard failed', e);
        return false;
      } finally {
        revealingRef.current = false;
      }
    },
    [matchApi, effectiveMatchId, boardOwner],
  );

  const loadBoards = useCallback(async () => {
    if (!matchApi || !effectiveMatchId) return;
    try {
      const state = (await matchApi.getMatchState({ matchId: effectiveMatchId })) as MatchStateView;
      const shots = (await matchApi.getShots({ matchId: effectiveMatchId })) as ShotsView;
      const incoming = (await matchApi.getIncomingShots({ matchId: effectiveMatchId })) as ShotsView;
      setSize(shots.size);
      setMatchState(state);
      setShotsBoard(shots.shots);

      const committed = boardOwner ? state.committed.includes(boardOwner) : false;
      setPlaced(committed);
      setOpponentNotReady(committed && state.committed.length < 2);

      const stored = boardOwner ? loadBoard(boardOwner, effectiveMatchId) : null;
      setBoardMissing(committed && !stored);
      if (!stored) {
        setOwnBoard([]);
        return;
      }
      setOwnBoard(overlayOwnBoard(stored.cells, incoming.shots));

      // Our move, if it is ours: answer the shot, then open the board if that
      // answer (or an earlier one) ended the match. Each writes something that
      // changes what the reads above said, so read again after each.
      let latest = state;
      if (await answerPendingShot(latest, stored.cells)) {
        latest = (await matchApi.getMatchState({ matchId: effectiveMatchId })) as MatchStateView;
      }
      if (await revealIfDue(latest, stored.cells, saltBytes(stored))) {
        latest = (await matchApi.getMatchState({ matchId: effectiveMatchId })) as MatchStateView;
      }
      if (latest !== state) {
        const nextIncoming = (await matchApi.getIncomingShots({ matchId: effectiveMatchId })) as ShotsView;
        setMatchState(latest);
        setOwnBoard(overlayOwnBoard(stored.cells, nextIncoming.shots));
      }
    } catch {
      // not readable yet; the next event or poll retries
    }
  }, [matchApi, effectiveMatchId, boardOwner, answerPendingShot, revealIfDue]);

  const loadTurnInfo = useCallback(async () => {
    if (!matchApi || !effectiveMatchId) return;
    try {
      setCurrentTurn(await matchApi.getCurrentTurn({ matchId: effectiveMatchId }));
    } catch {
      // turn info not yet available
    }
  }, [matchApi, effectiveMatchId]);

  useEffect(() => {
    if (currentUser && currentTurn) {
      setIsMyTurn(currentUser === currentTurn);
    } else {
      setIsMyTurn(false);
    }
  }, [currentTurn, currentUser]);

  /**
   * Keep the member list fresh while the lobby is on screen. Someone joining
   * the organization is no event of this app's, so the roster is polled.
   */
  useEffect(() => {
    if (view !== 'lobby-select' && view !== 'lobby') return undefined;
    if (!lobby.namespaceId) return undefined;
    const id = setInterval(() => {
      void lobby.refetchMembers();
      void lobby.refetchPlayerKeys();
    }, 10_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the two refetchers are what matter
  }, [view, lobby.namespaceId, lobby.refetchMembers, lobby.refetchPlayerKeys]);

  /**
   * Any state change from the other side clears the "opponent not deployed"
   * latch, which otherwise disables Fire with no way out but a reload.
   */
  const handleBoardUpdate = useCallback(() => {
    setOpponentNotReady(false);
    void loadBoards();
    void loadTurnInfo();
  }, [loadBoards, loadTurnInfo]);
  const handleTurnUpdate = useCallback(() => {
    setOpponentNotReady(false);
    void loadTurnInfo();
  }, [loadTurnInfo]);

  const refreshMatchList = useCallback(async () => {
    if (!lobbyApi) return;
    try {
      setMyMatches(((await lobbyApi.contract.getMatches()) as WireMatchSummary[]).map(toMatchSummary));
    } catch { /* non-critical */ }
  }, [lobbyApi]);

  const refreshHistory = useCallback(async () => {
    if (!lobbyApi) return;
    try {
      setHistory(((await lobbyApi.contract.getHistory()) as WireMatchRecord[]).map(toMatchRecord));
    } catch { /* non-critical */ }
  }, [lobbyApi]);

  const refreshPlayerStats = useCallback(async () => {
    if (!lobbyApi || !currentUser) return;
    try {
      const stats = (await lobbyApi.contract.getPlayerStats({ player: currentUser })) as WirePlayerStats | null;
      setPlayerStats(stats ? toPlayerStats(stats) : null);
    } catch { /* non-critical — no record yet for this player */ }
  }, [lobbyApi, currentUser]);

  // Initial fetch + refresh whenever the lobby changes.
  useEffect(() => {
    setMyMatches([]);
    void refreshMatchList();
  }, [refreshMatchList]);
  useEffect(() => { void refreshHistory(); }, [refreshHistory]);
  useEffect(() => { void refreshPlayerStats(); }, [refreshPlayerStats]);

  // A safety-net poll while a match is open: events are the fast path, but a
  // shot to answer or a reveal to make is this client's job, and a stream that
  // was reconnecting would otherwise leave the opponent waiting.
  useEffect(() => {
    if (view !== 'game' || !lobbyApi) return undefined;
    const interval = setInterval(() => { void refreshMatchList(); void loadBoards(); }, 5000);
    return () => clearInterval(interval);
  }, [view, lobbyApi, refreshMatchList, loadBoards]);

  const handleGameEvent = useCallback(
    (event: AllGameEvents) => {
      if (event.type === 'ShotProposed' && !isMyTurn && typeof event.x === 'number' && typeof event.y === 'number') {
        setPendingShot({ x: event.x, y: event.y });
      }
      if (event.type === 'ShotFired' || event.type === 'MatchEnded' || event.type === 'Winner') {
        setPendingShot(null);
      }
      if (event.type === 'MatchListUpdated' || event.type === 'MatchCreated' || event.type === 'MatchEnded' || event.type === 'Winner') {
        void refreshMatchList();
        void refreshHistory();
      }
      if (event.type === 'PlayerStatsUpdated') {
        void refreshPlayerStats();
      }
      if (event.type === 'PlayersUpdated') {
        void lobby.refetchPlayerKeys();
      }
    },
    [isMyTurn, refreshMatchList, refreshHistory, refreshPlayerStats, lobby],
  );

  // ---------------------------------------------------------------------------
  // Subscriptions: the lobby instance's one event stream
  // ---------------------------------------------------------------------------

  const fromIndex = useCallback(() => lobbyApi?.index() ?? 0, [lobbyApi]);
  const { isSubscribed: isEventSubscribed } = useGameSubscriptions({
    client,
    appId: view === 'lobby-select' ? null : lobby.namespaceId,
    fromIndex,
    matchId: view === 'game' ? effectiveMatchId : undefined,
    onBoardUpdate: handleBoardUpdate,
    onTurnUpdate: handleTurnUpdate,
    onGameEvent: handleGameEvent,
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const openGame = useCallback((id: string) => {
    setMatchId(id);
    setView('game');
    const lobbyId = lobby.namespaceId ? `&id=${encodeURIComponent(lobby.namespaceId)}` : '';
    navigate(`/match?match_id=${encodeURIComponent(id)}${lobbyId}`, { replace: true });
  }, [navigate, lobby.namespaceId]);

  const createMatch = useCallback(async () => {
    if (!lobbyApi) {
      show({ title: 'Lobby not ready yet — please wait a moment', variant: 'warning' });
      return;
    }
    const opponent = player2.trim();
    if (opponent === (currentUser ?? '')) {
      show({ title: 'You cannot challenge yourself', variant: 'error' });
      return;
    }
    setCreatingMatch(true);
    try {
      // The match is created and playable in the same call: there is no game
      // context to create, link or join any more.
      const id = await lobbyApi.contract.createMatch({ player2: opponent });
      void refreshMatchList();
      openGame(id);
      show({ title: 'Match created', variant: 'success' });
    } catch (e) {
      console.error('createMatch', e);
      show({ title: messageOf(e, 'Failed to create match'), variant: 'error' });
    } finally {
      setCreatingMatch(false);
    }
  }, [lobbyApi, player2, currentUser, show, refreshMatchList, openGame]);

  useEffect(() => {
    if (view === 'game') { void loadBoards(); void loadTurnInfo(); }
  }, [view, loadBoards, loadTurnInfo]);

  // ---------------------------------------------------------------------------
  // Ship placement logic
  // ---------------------------------------------------------------------------

  const floodFillShip = (
    g: boolean[][], visited: boolean[][], startX: number, startY: number, sz: number,
  ): [number, number][] => {
    const ship: [number, number][] = [];
    const stack: [number, number][] = [[startX, startY]];
    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!;
      if (cx < 0 || cx >= sz || cy < 0 || cy >= sz || visited[cy][cx] || !g[cy][cx]) continue;
      visited[cy][cx] = true;
      ship.push([cx, cy]);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    return ship;
  };

  const toggleCell = useCallback(
    (x: number, y: number) => {
      if (isRemovalMode) {
        if (!grid[y][x]) return;
        const visited = Array.from({ length: size }, () => Array(size).fill(false));
        const ship = floodFillShip(grid, visited, x, y, size);
        if (ship.length > 0) {
          const shipLen = ship.length;
          if (shipLen >= 2 && shipLen <= 5) {
            const idx = shipLen - 2;
            setShipCounts((prev) => { const next = [...prev]; next[idx] = Math.max(0, next[idx] - 1); return next; });
          }
          setGrid((prev) => { const next = prev.map((row) => row.slice()); ship.forEach(([sx, sy]) => (next[sy][sx] = false)); return next; });
        }
      } else if (selectedShip === null) {
        show({ title: 'Select a ship length first', variant: 'warning' });
      } else {
        const shipLen = selectedShip + 2;
        if (shipCounts[selectedShip] >= shipTargets[selectedShip]) {
          show({ title: `Already placed ${shipTargets[selectedShip]} ship(s) of length ${shipLen}`, variant: 'warning' });
          return;
        }
        const coords: [number, number][] = [];
        for (let i = 0; i < shipLen; i++) {
          const nx = isHorizontal ? x + i : x;
          const ny = isHorizontal ? y : y + i;
          if (nx >= size || ny >= size || grid[ny][nx]) break;
          coords.push([nx, ny]);
        }
        if (coords.length === shipLen) {
          const coordsSet = new Set(coords.map(([nx, ny]) => `${nx},${ny}`));
          const hasAdjacentExisting = coords.some(([nx, ny]) =>
            [[nx+1,ny],[nx-1,ny],[nx,ny+1],[nx,ny-1],[nx+1,ny+1],[nx+1,ny-1],[nx-1,ny+1],[nx-1,ny-1]].some(([ax, ay]) => {
              if (ax < 0 || ay < 0 || ax >= size || ay >= size) return false;
              if (coordsSet.has(`${ax},${ay}`)) return false;
              return grid[ay][ax];
            }),
          );
          if (hasAdjacentExisting) { show({ title: 'Ships cannot touch each other', variant: 'error' }); return; }
          setGrid((prev) => { const next = prev.map((row) => row.slice()); coords.forEach(([nx, ny]) => (next[ny][nx] = true)); return next; });
          setShipCounts((prev) => { const next = [...prev]; next[selectedShip] += 1; return next; });
        } else {
          show({ title: `Cannot place ship of length ${shipLen} here`, variant: 'error' });
        }
      }
    },
    [selectedShip, shipCounts, shipTargets, size, show, isHorizontal, isRemovalMode, grid],
  );

  const placeShips = useCallback(async () => {
    if (!matchApi || !matchApiReady) { show({ title: 'Lobby not ready yet — please wait a moment', variant: 'warning' }); return; }
    if (!effectiveMatchId) { show({ title: 'Set match id first', variant: 'error' }); return; }
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const groups: string[] = [];
      const visited = Array.from({ length: size }, () => Array(size).fill(false));
      for (let yy = 0; yy < size; yy++) {
        for (let xx = 0; xx < size; xx++) {
          if (grid[yy][xx] && !visited[yy][xx]) {
            const ship = floodFillShip(grid, visited, xx, yy, size);
            if (ship.length > 0) groups.push(ship.map(([sx, sy]) => `${sx},${sy}`).join(';'));
          }
        }
      }
      if (groups.length === 0) { show({ title: 'Place ships on the grid', variant: 'error' }); loadingRef.current = false; return; }
      const fleetError = validateFleetPayload(groups);
      if (fleetError) { show({ title: fleetError, variant: 'error' }); loadingRef.current = false; return; }
      if (!boardOwner) { show({ title: 'Not signed in', variant: 'warning' }); loadingRef.current = false; return; }

      // The board never leaves this device. What the contract gets is the
      // commitment; the cells and the salt are saved here FIRST, so a request
      // that fails after the cluster recorded it cannot leave a commitment
      // with nothing to answer shots from or reveal at the end.
      const cells = cellsFromShips(groups, size);
      const salt = randomSalt();
      const commitment = await computeCommitment(cells, salt);
      if (!saveBoard(boardOwner, effectiveMatchId, { cells, salt: saltHex(salt), commitment })) {
        show({ title: 'This browser refuses to store your board, so a fleet placed here could not answer shots', variant: 'error' });
        loadingRef.current = false;
        return;
      }
      await matchApi.commitBoard({ matchId: effectiveMatchId, commitment });
      show({ title: 'Fleet deployed', variant: 'success' });
      await loadBoards();
      await loadTurnInfo();
    } catch (e) {
      console.error('placeShips', e);
      show({ title: messageOf(e, 'Failed to place ships'), variant: 'error' });
    } finally {
      loadingRef.current = false;
    }
  }, [matchApi, matchApiReady, effectiveMatchId, boardOwner, grid, size, show, loadBoards, loadTurnInfo]);

  // ---------------------------------------------------------------------------
  // Shooting logic
  // ---------------------------------------------------------------------------

  const handleShotGridClick = useCallback((clickX: number, clickY: number) => {
    if (!isMyTurn || matchFinished) return;
    setSelectedShotX(clickX);
    setSelectedShotY(clickY);
  }, [isMyTurn, matchFinished]);

  const proposeShot = useCallback(async (shotX?: number, shotY?: number) => {
    if (matchFinished) return;
    if (!matchApi || !matchApiReady) { show({ title: 'Lobby not ready yet — please wait a moment', variant: 'warning' }); return; }
    if (!effectiveMatchId) { show({ title: 'Set match id first', variant: 'error' }); return; }
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const finalX = shotX !== undefined ? shotX : 0;
      const finalY = shotY !== undefined ? shotY : 0;
      await matchApi.proposeShot({ matchId: effectiveMatchId, x: finalX, y: finalY });
      setOpponentNotReady(false);
      show({ title: `Shot fired at (${finalX}, ${finalY})`, variant: 'success' });
      await loadBoards();
      await loadTurnInfo();
      setSelectedShotX(null);
      setSelectedShotY(null);
      setPendingShot(null);
    } catch (e) {
      console.error('proposeShot', e);
      // A match that is over refreshes instead of showing an error, so the UI
      // moves to the finish state even if the event that said so was missed.
      if (isMatchFinishedError(e)) {
        void refreshMatchList();
        show({ title: 'Match already finished', variant: 'info' });
      } else if (isShipsNotPlacedError(e)) {
        setOpponentNotReady(true);
        show({ title: 'Your opponent has not deployed their fleet yet', variant: 'warning' });
      } else {
        show({ title: messageOf(e, 'Failed to fire shot'), variant: 'error' });
      }
    } finally {
      loadingRef.current = false;
    }
  }, [matchApi, matchApiReady, effectiveMatchId, matchFinished, refreshMatchList, show, loadBoards, loadTurnInfo]);

  // ---------------------------------------------------------------------------
  // Lobby actions
  // ---------------------------------------------------------------------------

  // The next sign-in starts at the picker, not inside this session's lobby.
  const doLogout = useCallback(() => {
    if (scope) forgetLastLobby(scope);
    void sessionApi.signOut();
    navigate('/');
  }, [sessionApi, navigate, scope]);

  const handleCreateLobby = useCallback(async () => {
    const name = newLobbyName.trim();
    try {
      await lobby.createLobby(name || undefined);
    } catch (e) {
      show({ title: messageOf(e, 'Failed to create lobby'), variant: 'error' });
      return;
    }
    setNewLobbyName('');
    show({ title: 'Lobby created', variant: 'success' });
  }, [lobby, newLobbyName, show]);

  const handleCreateInvitation = useCallback(async () => {
    try {
      // An org invitation, approved with your passkey: the link carries the
      // token and the lobby to open once it is redeemed.
      const link = await lobby.invitePlayer();
      if (link) {
        setInvitationLink(link);
        show({ title: 'Invitation link created', variant: 'success' });
      }
    } catch (e) {
      show({ title: messageOf(e, 'Could not create an invitation'), variant: 'error' });
    }
  }, [lobby, show]);

  const handleEnterLobby = useCallback(() => {
    if (!lobby.namespaceId) { show({ title: 'No lobby selected', variant: 'error' }); return; }
    manualLobbySelect.current = false;
    setView('lobby');
    navigate(`/lobby?id=${encodeURIComponent(lobby.namespaceId)}`, { replace: true });
  }, [lobby, show, navigate]);

  const resetToLobby = useCallback(() => {
    setMatchId('');
    setPlaced(false);
    setMatchState(null);
    setBoardMissing(false);
    setOpponentNotReady(false);
    answeredShotRef.current = null;
    setOwnBoard([]);
    setShotsBoard([]);
    setCurrentTurn(null);
    setIsMyTurn(false);
    setPendingShot(null);
    setSelectedShotX(null);
    setSelectedShotY(null);
    setGrid(Array.from({ length: 10 }, () => Array(10).fill(false)));
    setShipCounts([0, 0, 0, 0]);
    setView('lobby');
    const lobbyId = lobby.namespaceId ? `?id=${encodeURIComponent(lobby.namespaceId)}` : '';
    navigate(`/lobby${lobbyId}`, { replace: true });
  }, [navigate, lobby.namespaceId]);

  // ===========================================================================
  // RENDER
  // ===========================================================================

  const navProps = {
    namespaceName: view === 'lobby-select' ? null : lobby.selectedLobby?.alias,
    namespaceId: view === 'lobby-select' ? null : lobby.namespaceId,
    currentUser,
    onLogout: doLogout,
  };

  // --- Not signed in: where the build connects, and a passkey ---
  if (session.status !== 'signed-in') {
    return (
      <div className="app-bg">
        <div className="page-shell">
          <div className="page-content">
            {session.status === 'connecting' && <span className="mono-sm">Connecting…</span>}
            {session.status === 'listing' && <AppListing {...LISTING} />}
            {session.status === 'unconfigured' && (
              <div className="lobby-banner-error" role="alert">
                <span className="lobby-banner-error-glyph" aria-hidden>!</span>
                <span>{session.message}</span>
              </div>
            )}
            {session.status === 'signed-out' && (
              <ConnectCard api={sessionApi} where={describeTarget(session.target)} />
            )}
            <AppFooter />
          </div>
        </div>
      </div>
    );
  }

  // --- An invitation: asked before anything is joined ---
  if (invite) {
    const from = inviter(invite);
    return (
      <div className="app-bg">
        <NavBar {...navProps} />
        <div className="page-shell">
          <div className="page-content">
            <JoinInvitation
              {...ONBOARDING}
              key={invite.token}
              joining={from ? `${from}'s game` : 'the game'}
              account={formatKey(session.accountId)}
              client={session.client}
              token={invite.token}
              org={invite.org}
              drop={invites.drop}
              after={after}
              onJoined={({ org }) => {
                setAsked(null);
                setLanding({ org, lobby: invitedLobby(invite) });
              }}
              onClose={({ member }) => {
                setAsked(null);
                if (member) setLanding({ org: member, lobby: invitedLobby(invite), member: true });
              }}
            />
            <AppFooter />
          </div>
        </div>
      </div>
    );
  }

  // --- Lobby Select ---
  if (view === 'lobby-select') {
    return (
      <div className="app-bg">
        <NavBar {...navProps} />
        <div className="page-shell">
          <div className="page-content">
            <LobbySelect
              lobbies={lobby.lobbies}
              lobbiesLoading={lobby.lobbiesLoading}
              lobbiesFailed={!!lobby.lobbiesError}
              onRetryLobbies={() => void lobby.refetchLobbies()}
              selectedNamespaceId={lobby.selectedLobby?.namespaceId || null}
              lobbyContextId={lobby.lobbyContextId}
              namespaceId={lobby.namespaceId}
              createLobbyLoading={lobby.createLobbyLoading}
              newLobbyName={newLobbyName}
              onNewLobbyNameChange={setNewLobbyName}
              onSelectLobby={lobby.selectLobby}
              onCreateLobby={handleCreateLobby}
              onEnter={handleEnterLobby}
            />
            {/* Inside `.page-content`, NOT beside it: `.page-shell` is a flex
                ROW, so a footer placed as its sibling becomes a second column
                squeezed next to the page instead of a band under it. */}
            <AppFooter />
          </div>
        </div>
      </div>
    );
  }

  // --- Lobby ---
  if (view === 'lobby') {
    return (
      <div className="app-bg">
        <NavBar {...navProps} />
        <div className="page-shell">
          <div className="page-content">
            {/* Back belongs with the content it backs out of, not in the bar:
                the bar is the same on every screen, and a control that appears
                and disappears there shifts the brand around under the cursor. */}
            <button
              type="button"
              className="page-back"
              onClick={() => {
                // Back to the picker on purpose: a reload keeps you there.
                if (scope) forgetLastLobby(scope);
                manualLobbySelect.current = true;
                setView('lobby-select');
                navigate('/lobby', { replace: true });
              }}
            >
              <span aria-hidden>&larr;</span> All lobbies
            </button>
            <LobbyView
              lobbyAlias={lobby.selectedLobby?.alias}
              isAdmin={lobby.isAdmin}
              membersLoading={lobby.membersLoading}
              playerKeys={lobby.playerKeys}
              playerByAccount={lobby.playerByAccount}
              onChallengePlayer={setPlayer2}
              members={lobby.members}
              teeMembers={lobby.teeMembers}
              selfIdentity={lobby.selfIdentity}
              executorPublicKey={lobby.executorPublicKey}
              inviteLoading={lobby.inviteLoading}
              invitationJson={invitationLink}
              onCreateInvitation={handleCreateInvitation}
              onDismissInvitation={() => setInvitationLink(null)}
              player2={player2}
              creatingMatch={creatingMatch}
              onPlayer2Change={setPlayer2}
              onCreateMatch={createMatch}
              matches={myMatches}
              onOpenGame={openGame}
              playerStats={playerStats}
              history={history}
              currentUser={currentUser}
              nameOf={nameOf}
              onSaveName={saveName}
            />
          </div>
        </div>
      </div>
    );
  }

  // --- Game ---
  return (
    <div className="app-bg">
      <NavBar {...navProps} />
      <div className="page-shell">
        <div className="page-content page-content-wide">
          <button type="button" className="page-back" onClick={resetToLobby}>
            <span aria-hidden>&larr;</span> Back to lobby
          </button>
          {/* Match header */}
          <div className="naval-card fade-in">
            <div className="naval-card-header">
              <div className="naval-card-title">
                Match
                <span className="mono-sm" style={{ fontSize: '0.75rem' }}>
                  {effectiveMatchId}
                </span>
              </div>
            </div>
            <div className="naval-card-body">
              <div className="info-row">
                <span className="mono-sm">
                  {placed ? 'Fleet deployed' : 'Deploy your fleet to begin'}
                </span>
                {boardMissing && (
                  <span className="mono-sm" style={{ color: 'var(--select-cyan)' }} data-testid="board-missing">
                    Your board for this match is not on this device — shots cannot be answered from here.
                  </span>
                )}
                <span className={`badge ${isEventSubscribed ? 'badge-live' : 'badge-offline'}`}>
                  {isEventSubscribed ? 'Live' : 'Offline'}
                </span>
              </div>
            </div>
          </div>

          {/* Ship placement */}
          {!placed && matchApiReady && (
            <div className="naval-card fade-in fade-in-delay-1">
              <div className="naval-card-header">
                <div className="naval-card-title">Deploy Fleet</div>
              </div>
              <div className="naval-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <ShipSelector
                  selectedShip={selectedShip}
                  shipCounts={shipCounts}
                  shipTargets={shipTargets}
                  isHorizontal={isHorizontal}
                  isRemovalMode={isRemovalMode}
                  onSelectShip={(idx) => { setSelectedShip(idx); setIsRemovalMode(false); }}
                  onSetHorizontal={setIsHorizontal}
                  onToggleRemoval={() => { setIsRemovalMode(!isRemovalMode); setSelectedShip(null); }}
                />
                <PlacementGrid size={size} grid={grid} onCellClick={toggleCell} />
                <button
                  className="btn-deploy"
                  onClick={placeShips}
                  disabled={!matchApiReady || shipCounts.some((c, i) => c !== shipTargets[i])}
                  style={{ alignSelf: 'flex-start' }}
                >
                  Deploy Fleet
                </button>
              </div>
            </div>
          )}

          {/* Active game boards */}
          {placed && (
            <div className="boards-grid fade-in fade-in-delay-1">
              <div className="naval-card">
                <div className="naval-card-header">
                  <div className="naval-card-title">Your Waters</div>
                </div>
                <div className="naval-card-body">
                  <GameBoard
                    size={size}
                    board={ownBoard}
                    label="Defense Grid"
                    pendingShot={pendingShot}
                  />
                </div>
              </div>

              <div className="naval-card">
                <div className="naval-card-header">
                  <div className="naval-card-title">
                    Enemy Waters
                    {matchFinished ? (
                      <span className="badge badge-live">
                        {awaitingReveal ? 'Auditing' : isWinner ? 'Victory' : 'Defeat'}
                      </span>
                    ) : (
                      isMyTurn && <span className="badge badge-live">Your Turn</span>
                    )}
                  </div>
                </div>
                <div className="naval-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <ShotGrid
                    size={size}
                    shots={shotsBoard}
                    isMyTurn={isMyTurn && !matchFinished}
                    selectedX={selectedShotX}
                    selectedY={selectedShotY}
                    onCellClick={handleShotGridClick}
                  />

                  {matchFinished && (
                    <div
                      style={{
                        padding: '0.75rem 1rem',
                        border: '1px solid var(--select-cyan)',
                        borderRadius: 4,
                        background: 'rgba(0, 255, 255, 0.05)',
                      }}
                    >
                      <div className="mono" style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                        {awaitingReveal
                          ? 'Match over on the answers — auditing the boards.'
                          : isWinner
                            ? '🏆 You won this match.'
                            : 'Match over.'}
                      </div>
                      {awaitingReveal && (
                        <div className="mono-sm" style={{ opacity: 0.75 }}>
                          {ownRevealed
                            ? 'Your board is revealed. Waiting for your opponent to reveal theirs.'
                            : boardMissing
                              ? 'Your board is not on this device, so it cannot be revealed from here.'
                              : 'Revealing your board…'}
                        </div>
                      )}
                      {auditFailed.length > 0 && (
                        <div className="mono-sm" style={{ opacity: 0.75, wordBreak: 'break-all' }}>
                          {auditFailed.includes(currentUser ?? '')
                            ? 'Your answers did not match your revealed board. The game goes to your opponent.'
                            : 'Your opponent’s answers did not match their revealed board. The game is yours.'}
                        </div>
                      )}
                      {standing === 'void' && (
                        <div className="mono-sm" style={{ opacity: 0.75 }}>
                          Both boards failed the audit. Nobody wins this one.
                        </div>
                      )}
                      {matchWinner && (
                        <div className="mono-sm" style={{ opacity: 0.75, wordBreak: 'break-all' }}>
                          Winner: {playerName(matchWinner, {
                            playerByAccount: lobby.playerByAccount,
                            selfIdentity: lobby.selfIdentity,
                            executorPublicKey: lobby.executorPublicKey,
                            nameOf,
                          })}
                        </div>
                      )}
                      <button
                        className="btn-fire"
                        style={{ marginTop: '0.75rem' }}
                        onClick={resetToLobby}
                      >
                        Back to Lobby
                      </button>
                    </div>
                  )}

                  {!matchFinished && selectedShotX !== null && selectedShotY !== null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div className="info-pair">
                        <span className="info-label">Target</span>
                        <span className="mono" style={{ color: 'var(--select-cyan)', fontWeight: 700 }}>
                          {'ABCDEFGHIJ'[selectedShotX]}{selectedShotY + 1}
                        </span>
                      </div>
                      <button
                        className="btn-fire"
                        disabled={!matchApiReady || !isMyTurn || opponentNotReady}
                        title={opponentNotReady ? 'Your opponent has not deployed their fleet yet' : undefined}
                        onClick={() => proposeShot(selectedShotX, selectedShotY)}
                      >
                        Fire
                      </button>
                    </div>
                  )}

                  {!matchFinished && opponentNotReady && (
                    <span className="mono-sm">Waiting for your opponent to deploy their fleet…</span>
                  )}

                  {!matchFinished && !isMyTurn && placed && !opponentNotReady && (
                    <span className="mono-sm">Waiting for opponent...</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
