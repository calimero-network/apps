import React, { useMemo, useState } from 'react';
import { Input } from '@calimero-network/mero-ui';
import CopyButton from './CopyButton';
import type { MatchSummary, MatchRecord, PlayerStatsView } from '../generated/lobby/LobbyClient';

interface GroupMember {
  identity: string;
  role: string;
}

type HistoryFilter = 'all' | 'mine';

interface LobbyViewProps {
  lobbyAlias?: string | null;
  isAdmin: boolean;
  members: GroupMember[];
  /** Player keys in this lobby — what `create_match` accepts. */
  playerKeys: string[];
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
  onOpenGame: (matchId: string, contextId: string) => void;

  // Player record + match history (lobby-wide, sourced from getPlayerStats /
  // getHistory on the lobby context — see useBattleshipsLobby + match page).
  playerStats: PlayerStatsView | null;
  history: MatchRecord[];
  currentUser: string | null;
}

const formatKey = (k: string) => `${k.slice(0, 8)}…${k.slice(-4)}`;
const formatTs = (ms: number) => new Date(ms).toLocaleString(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export default function LobbyView({
  lobbyAlias, isAdmin, members, playerKeys, onChallengePlayer, selfIdentity, executorPublicKey,
  inviteLoading, invitationJson, onCreateInvitation, onDismissInvitation,
  player2, creatingMatch, onPlayer2Change, onCreateMatch,
  matches, onOpenGame,
  playerStats, history, currentUser,
}: LobbyViewProps) {
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [matchTab, setMatchTab] = useState<'matches' | 'record' | 'history'>('matches');

  /**
   * Who to list as a player.
   *
   * ⚠️ YOUR OWN KEY IS INCLUDED WITHOUT WAITING FOR THE LOOKUP. This node knows
   * its own executor key from the client it built, so gating the row on a round
   * trip is what made the whole section — your key included — disappear behind
   * "2 members online" when the context identities came back empty.
   *
   * De-duplicated, because once the lookup does answer, your key is in it too.
   */
  const shownPlayers = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const key of [executorPublicKey, ...playerKeys]) {
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  }, [executorPublicKey, playerKeys]);

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
          </div>
        </div>
        <div className="naval-card-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <span className="mono-sm">
              {members.length} member{members.length !== 1 ? 's' : ''} online
            </span>

            {/* ⚠️ PLAYER keys, from the lobby CONTEXT — not the group's member
                rows, which are keyed by ACCOUNT id and which `create_match`
                rejects as "not a player". Since rc.27 both render as 64 hex, so
                listing the accounts here would offer a copy button for the one
                id that cannot start a game.
                ⚠️ AND IT ALWAYS RENDERS. Gating the whole block on
                `playerKeys.length` meant that when the context identity lookup
                came back empty — which it does until this node has joined the
                lobby context — the section vanished and took the player's OWN
                key with it: "2 members online" and nothing else on screen. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span className="info-label">Players in this lobby</span>
                <span className="console-hint">
                  Copy yours to invite someone to challenge you; challenge anyone
                  else with one click.
                </span>
                {shownPlayers.length === 0 && (
                  <span className="console-hint">
                    Resolving your player key…
                  </span>
                )}
                {shownPlayers.length === 1 && members.length > 1 && (
                  <span className="console-hint">
                    {members.length - 1} other member
                    {members.length > 2 ? 's have' : ' has'} joined this lobby but
                    not opened it yet. They appear here, ready to challenge, once
                    they do.
                  </span>
                )}
                {shownPlayers.map((key) => {
                  const isSelf = key === executorPublicKey;
                  return (
                    <div key={key} className="member-row">
                      <span className="mono-sm" style={{ fontSize: '0.75rem' }}>
                        {key.slice(0, 12)}…{key.slice(-8)}
                      </span>
                      <CopyButton text={key} label="Copy" copiedLabel="Copied" className="btn-icon" />
                      {isSelf ? (
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-accent)' }}>you</span>
                      ) : (
                        <button
                          type="button"
                          className="btn-icon"
                          onClick={() => onChallengePlayer(key)}
                        >
                          Challenge
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>

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
                <pre className="invite-code invite-link">{invitationJson}</pre>
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
              placeholder="Opponent's player key"
              value={player2}
              onChange={(e) => onPlayer2Change(e.target.value)}
            />
            {/* Same control, same colour story as Create and Join: inert
                until there is an opponent key to challenge. */}
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
                    const canOpen = m.status === 'Active' && !!m.context_id;
                    return (
                      <div key={m.match_id} className="match-item">
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
                                Winner: {m.winner.slice(0, 8)}...
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="lobby-row-cta"
                          disabled={!canOpen}
                          onClick={() => canOpen && onOpenGame(m.match_id, m.context_id!)}
                        >
                          {canOpen ? 'Open' : m.status === 'Pending' ? 'Pending' : 'Ended'}
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
                              {formatKey(r.winner)} beat {formatKey(r.loser)}
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
