import { useCallback, useMemo, useState } from 'react';
import { Input } from '@calimero-network/mero-ui';
import { ShieldCheck } from '@calimero-network/mero-icons';
import CopyButton from './CopyButton';
import type { MatchSummary, MatchRecord, PlayerStatsView } from '../battleships';
import { formatKey, playerName } from '../utils/playerName';

interface GroupMember {
  identity: string;
  role: string;
  name?: string;
}

type HistoryFilter = 'all' | 'mine';

interface LobbyViewProps {
  lobbyAlias?: string | null;
  isAdmin: boolean;
  members: GroupMember[];
  /** v1: TEE nodes admitted to the namespace. An organization has none, so this stays empty. */
  teeMembers?: GroupMember[];
  membersLoading: boolean;
  /** Accounts that have opened this lobby: what `createMatch` accepts. */
  playerKeys: string[];
  /** account id -> the id it plays as (the account itself). */
  playerByAccount: Record<string, string>;
  /** Fill the challenge field from a player row. */
  onChallengePlayer: (key: string) => void;
  selfIdentity: string | null;
  executorPublicKey: string | null;

  // Invitation
  inviteLoading: boolean;
  invitationJson: string | null;
  onCreateInvitation: () => void;
  onDismissInvitation: () => void;

  // Match creation
  player2: string;
  creatingMatch: boolean;
  onPlayer2Change: (v: string) => void;
  onCreateMatch: () => void;

  // Match list
  matches: MatchSummary[];
  onOpenGame: (matchId: string) => void;

  // Player record + match history (lobby-wide, sourced from getPlayerStats /
  // getHistory on the lobby instance — see useBattleshipsLobby + match page).
  playerStats: PlayerStatsView | null;
  history: MatchRecord[];
  currentUser: string | null;

  /** The name an account set in the lobby's organization. */
  nameOf?: (account: string) => string | undefined;
  /** Set your name in the lobby's organization. Omitted, the name field is hidden. */
  onSaveName?: (name: string) => void;
}

const formatTs = (ms: number) => new Date(ms).toLocaleString(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export default function LobbyView({
  lobbyAlias, isAdmin, members, teeMembers = [], membersLoading, playerByAccount,
  onChallengePlayer, selfIdentity, executorPublicKey,
  inviteLoading, invitationJson, onCreateInvitation, onDismissInvitation,
  player2, creatingMatch, onPlayer2Change, onCreateMatch,
  matches, onOpenGame,
  playerStats, history, currentUser,
  nameOf, onSaveName,
}: LobbyViewProps) {
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const selfName = selfIdentity ? nameOf?.(selfIdentity) ?? '' : '';
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const nameValue = nameDraft ?? selfName;
  const nameSources = { playerByAccount, selfIdentity, executorPublicKey, nameOf };
  const nameOfKey = (key: string) => playerName(key, nameSources);
  const [matchTab, setMatchTab] = useState<'matches' | 'record' | 'history'>('matches');

  /**
   * The id a member row challenges with: their account, once they have opened
   * the lobby (`registerPlayer`, which the contract's `getPlayers` lists). Your
   * own row has it without waiting for the read.
   */
  const playerKeyForMember = useCallback(
    (identity: string): string | null => {
      const recorded = playerByAccount[identity];
      if (recorded) return recorded;
      if (identity === selfIdentity) return executorPublicKey ?? null;
      return null;
    },
    [executorPublicKey, playerByAccount, selfIdentity],
  );


  // Newest first, then optionally restricted to matches involving the
  // current user. Memoized so a re-render from sibling state changes
  // (e.g. invite toast) doesn't re-sort the array.
  const filteredHistory = useMemo(() => {
    const sorted = [...history].sort((a, b) => b.finished_ms - a.finished_ms);
    if (historyFilter === 'mine' && currentUser) {
      return sorted.filter((r) => r.winner === currentUser || r.loser === currentUser);
    }
    return sorted;
  }, [history, historyFilter, currentUser]);

  return (
    <>
      {/* Lobby info */}
      <div className="naval-card fade-in">
        <div className="naval-card-header">
          <div className="naval-card-title">
            {lobbyAlias || 'Lobby'}
            {isAdmin && <span className="badge badge-admin">Admin</span>}
            {/* A TEE node is infrastructure, not a player: it is not listed
                below, only noted here. */}
            {teeMembers.length > 0 && (
              <span
                className="badge badge-tee"
                data-testid="tee-indicator"
                title="A hardware-attested node keeps this workspace in sync and available when members are offline."
              >
                <ShieldCheck size={11} aria-hidden />
                TEE enabled
                <span className="badge-tee-mode">
                  {teeMembers.some((m) => m.role === 'RelayTee') ? 'Relay' : 'Replica'}
                </span>
              </span>
            )}
          </div>
        </div>
        <div className="naval-card-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <span className="mono-sm">
              {members.length} member{members.length !== 1 ? 's' : ''}
            </span>

            {/* The roster is the lobby organization's member list; the
                challengeable id is attached once a member has opened the lobby. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span className="info-label">Members</span>
              {membersLoading && members.length === 0 && (
                <span className="console-hint">Loading members…</span>
              )}
              {members.map((m) => {
                const isSelf = m.identity === selfIdentity;
                const key = playerKeyForMember(m.identity);
                const name = nameOf?.(m.identity);
                return (
                  <div key={m.identity} className="member-row" data-testid="lobby-member">
                    <span className={`member-role ${m.role === 'Admin' ? 'role-admin' : 'role-member'}`}>
                      {m.role}
                    </span>
                    {name && <span data-testid="member-name">{name}</span>}
                    {isSelf && (
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-accent)' }}>you</span>
                    )}
                    {key ? (
                      <>
                        {!name && (
                          <span className="mono-sm" style={{ fontSize: '0.72rem' }} title={key}>
                            {formatKey(key)}
                          </span>
                        )}
                        <CopyButton text={key} label="Copy" copiedLabel="Copied" className="btn-icon" />
                        {!isSelf && (
                          <button
                            type="button"
                            className="btn-icon"
                            data-testid="challenge-player"
                            onClick={() => onChallengePlayer(key)}
                          >
                            Challenge
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="console-hint" style={{ margin: 0 }}>
                        hasn&rsquo;t opened the lobby yet
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {onSaveName && selfIdentity && (
              <form
                onSubmit={(e) => { e.preventDefault(); onSaveName(nameValue.trim()); setNameDraft(null); }}
                style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}
              >
                <label className="info-label" htmlFor="lobby-your-name">Your name</label>
                <Input
                  id="lobby-your-name"
                  type="text"
                  placeholder="How other players see you"
                  maxLength={32}
                  value={nameValue}
                  onChange={(e) => setNameDraft(e.target.value)}
                />
                <button
                  type="submit"
                  className="btn-ghost"
                  disabled={!nameValue.trim() || nameValue.trim() === selfName}
                >
                  Save
                </button>
              </form>
            )}

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn-deploy"
                onClick={onCreateInvitation}
                disabled={inviteLoading}
              >
                {inviteLoading ? 'Creating…' : 'Invite player'}
              </button>
            </div>

            {invitationJson && (
              <div>
                {/* A link, not a JSON blob: it survives being pasted into a
                    chat, and opening it on a machine with the desktop app
                    hands the invitation straight to it. */}
                <pre className="invite-code invite-link" data-testid="invite-link">{invitationJson}</pre>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
                  <CopyButton text={invitationJson} label="Copy link" copiedLabel="Link copied" className="btn-ghost" />
                  <button type="button" className="btn-ghost" onClick={onDismissInvitation}>
                    Dismiss
                  </button>
                </div>
                <span style={{ display: 'block', marginTop: '0.4rem', fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  Send this link. Opening it joins the lobby.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create match */}
      <div className="naval-card fade-in fade-in-delay-1">
        <div className="naval-card-header">
          <div className="naval-card-title">New Match</div>
        </div>
        <div className="naval-card-body">
          <form
            onSubmit={(e) => { e.preventDefault(); onCreateMatch(); }}
            style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}
          >
            <Input
              type="text"
              placeholder="Opponent's account"
              value={player2}
              onChange={(e) => onPlayer2Change(e.target.value)}
            />
            {/* Same control, same colour story as Create and Join: inert
                until there is an opponent to challenge. */}
            <button
              type="submit"
              className="btn-deploy"
              disabled={creatingMatch || !player2.trim()}
            >
              {creatingMatch ? 'Creating…' : 'Challenge'}
            </button>
          </form>
        </div>
      </div>

      {/* ============================================================
          Matches, record and history — ONE card, three tabs
          ============================================================
          These were three stacked cards saying related things about the same
          matches, so the lobby was mostly chrome: three headers, three borders
          and a lot of scrolling to compare "what is running" with "what
          happened". One card, and the tab rail is the same control the lobby
          picker uses, so the two screens behave alike. */}
      <div className="naval-card fade-in fade-in-delay-2">
        <div className="naval-card-body">
          <div className="tab-rail" role="tablist" aria-label="Matches, record and history">
            <button
              type="button"
              role="tab"
              aria-selected={matchTab === 'matches'}
              className={`tab-btn ${matchTab === 'matches' ? 'tab-btn-active' : ''}`}
              onClick={() => setMatchTab('matches')}
            >
              Matches
              {matches.length > 0 && <span className="tab-count">{matches.length}</span>}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={matchTab === 'record'}
              className={`tab-btn ${matchTab === 'record' ? 'tab-btn-active' : ''}`}
              onClick={() => setMatchTab('record')}
            >
              Your record
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={matchTab === 'history'}
              className={`tab-btn ${matchTab === 'history' ? 'tab-btn-active' : ''}`}
              onClick={() => setMatchTab('history')}
            >
              History
              {history.length > 0 && <span className="tab-count">{history.length}</span>}
            </button>
          </div>

          {matchTab === 'matches' && (
            <div className="tab-content" key="matches" role="tabpanel">
              {matches.length === 0 ? (
                <span className="console-hint">No matches yet. Challenge an opponent above.</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {matches.map((m) => {
                    // Your own matches, until they are won: a pending one is
                    // where you deploy your fleet.
                    const mine = m.player1 === currentUser || m.player2 === currentUser;
                    const canOpen = mine && m.status !== 'Finished';
                    return (
                      <div key={m.match_id} className="match-item" data-testid="match-item">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <span className="match-id">{m.match_id}</span>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <span className={`status-pill ${
                              m.status === 'Active' ? 'status-active' :
                              m.status === 'Finished' ? 'status-finished' :
                              'status-pending'
                            }`}>
                              {m.status}
                            </span>
                            {m.winner && (
                              <span className="mono-sm" style={{ fontSize: '0.7rem' }}>
                                Winner: {nameOfKey(m.winner)}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="lobby-row-cta"
                          disabled={!canOpen}
                          onClick={() => canOpen && onOpenGame(m.match_id)}
                        >
                          {canOpen ? 'Open' : m.status === 'Finished' ? 'Ended' : m.status}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {matchTab === 'record' && (
            <div className="tab-content" key="record" role="tabpanel">
              {playerStats ? (
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  <div className="info-pair">
                    <span className="info-label">Wins</span>
                    <span className="info-value">{playerStats.wins}</span>
                  </div>
                  <div className="info-pair">
                    <span className="info-label">Losses</span>
                    <span className="info-value">{playerStats.losses}</span>
                  </div>
                  <div className="info-pair">
                    <span className="info-label">Games</span>
                    <span className="info-value">{playerStats.games_played}</span>
                  </div>
                </div>
              ) : (
                <span className="console-hint">No matches finished yet.</span>
              )}
            </div>
          )}

          {matchTab === 'history' && (
            <div className="tab-content" key="history" role="tabpanel">
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.25rem', marginBottom: '0.75rem' }}>
                <button
                  type="button"
                  className={`status-pill ${historyFilter === 'all' ? 'status-active' : 'status-pending'}`}
                  style={{ cursor: 'pointer', border: 'none' }}
                  onClick={() => setHistoryFilter('all')}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`status-pill ${historyFilter === 'mine' ? 'status-active' : 'status-pending'}`}
                  style={{ cursor: 'pointer', border: 'none' }}
                  onClick={() => setHistoryFilter('mine')}
                  disabled={!currentUser}
                  title={!currentUser ? 'Connect to filter by your matches' : undefined}
                >
                  Mine
                </button>
              </div>
              {filteredHistory.length === 0 ? (
                <span className="console-hint">
                  {historyFilter === 'mine'
                    ? "You haven't completed any matches in this lobby yet."
                    : 'No completed matches in this lobby yet.'}
                </span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {filteredHistory.map((r) => {
                    const youWon = currentUser && r.winner === currentUser;
                    const youLost = currentUser && r.loser === currentUser;
                    const involvedYou = youWon || youLost;
                    return (
                      <div key={r.match_id} className="match-item">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <span className="match-id">{r.match_id}</span>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span className="status-pill status-finished">
                              {youWon ? 'You won' : youLost ? 'You lost' : 'Finished'}
                            </span>
                            <span className="mono-sm" style={{ fontSize: '0.7rem' }}>
                              {nameOfKey(r.winner)} beat {nameOfKey(r.loser)}
                            </span>
                            <span className="mono-sm" style={{ fontSize: '0.7rem', opacity: 0.75 }}>
                              {formatTs(r.finished_ms)}
                            </span>
                          </div>
                        </div>
                        {involvedYou && (
                          <span className="mono-sm" style={{ fontSize: '0.65rem', color: 'var(--text-accent)' }}>
                            (you)
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
