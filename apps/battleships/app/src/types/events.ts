/**
 * Game event types emitted by the Battleships contract.
 *
 * Events are split into two categories, as v1's two services emitted them:
 * - **Lobby events** concern the lobby (match list, players, stats) and reach
 *   everyone in it.
 * - **Match events** concern one match (shots, ships, winner), carry its id,
 *   and reach its two players.
 * Both come over the lobby instance's one event stream now.
 */

export type LobbyEventType =
  | 'MatchCreated'
  | 'MatchListUpdated'
  | 'PlayerStatsUpdated'
  | 'PlayersUpdated';

export type MatchEventType =
  | 'ShipsPlaced'
  | 'BoardCommitted'
  | 'BoardRevealed'
  | 'AuditPassed'
  | 'AuditFailed'
  | 'RevealRequested'
  | 'ShotProposed'
  | 'ShotFired'
  | 'Winner'
  | 'MatchEnded';

export type GameEventType = LobbyEventType | MatchEventType;

export interface GameEvent {
  type: GameEventType;
  id: string;
  x?: number;
  y?: number;
  result?: string;
}

export interface MatchCreatedEvent extends GameEvent {
  type: 'MatchCreated';
  id: string;
}

export interface ShipsPlacedEvent extends GameEvent {
  type: 'ShipsPlaced';
  id: string;
}

export interface ShotProposedEvent extends GameEvent {
  type: 'ShotProposed';
  id: string;
  x: number;
  y: number;
}

export interface ShotFiredEvent extends GameEvent {
  type: 'ShotFired';
  id: string;
  x: number;
  y: number;
  result: string;
}

export interface WinnerEvent extends GameEvent {
  type: 'Winner';
  id: string;
}

export interface MatchEndedEvent extends GameEvent {
  type: 'MatchEnded';
  id: string;
}

export interface MatchListUpdatedEvent extends GameEvent {
  type: 'MatchListUpdated';
}

export interface PlayerStatsUpdatedEvent extends GameEvent {
  type: 'PlayerStatsUpdated';
}

/** Someone opened the lobby for the first time: the roster changed. */
export interface PlayersUpdatedEvent extends GameEvent {
  type: 'PlayersUpdated';
}

/** A player's SHA256 board commitment was recorded. */
export interface BoardCommittedEvent extends GameEvent {
  type: 'BoardCommitted';
  id: string;
  /** Base58 of the player's PublicKey. */
  player: string;
  /** 64-char lowercase hex SHA256 hash. */
  commitment: string;
}

/**
 * The answers ended the match. Both clients open the board on their device
 * with `reveal_board`; nothing counts until the winner's has been audited.
 */
export interface RevealRequestedEvent extends GameEvent {
  type: 'RevealRequested';
  id: string;
}

/** A player ran `reveal_board` and the lobby successfully recorded the reveal. */
export interface BoardRevealedEvent extends GameEvent {
  type: 'BoardRevealed';
  id: string;
  player: string;
}

/** Audit (commitment check + shot replay) succeeded for a player. */
export interface AuditPassedEvent extends GameEvent {
  type: 'AuditPassed';
  id: string;
  player: string;
}

/** Audit failed — commitment mismatch or a shot inconsistency. */
export interface AuditFailedEvent extends GameEvent {
  type: 'AuditFailed';
  id: string;
  player: string;
  reason: string;
}

export type LobbyEvent =
  | MatchCreatedEvent
  | MatchListUpdatedEvent
  | PlayerStatsUpdatedEvent
  | PlayersUpdatedEvent;

export type MatchEvent =
  | ShipsPlacedEvent
  | BoardCommittedEvent
  | BoardRevealedEvent
  | RevealRequestedEvent
  | AuditPassedEvent
  | AuditFailedEvent
  | ShotProposedEvent
  | ShotFiredEvent
  | WinnerEvent
  | MatchEndedEvent;

export type AllGameEvents = LobbyEvent | MatchEvent;

const LOBBY_EVENT_TYPES: ReadonlySet<string> = new Set<LobbyEventType>([
  'MatchCreated',
  'MatchListUpdated',
  'PlayerStatsUpdated',
  'PlayersUpdated',
]);

export function isLobbyEvent(event: AllGameEvents): event is LobbyEvent {
  return LOBBY_EVENT_TYPES.has(event.type);
}

export function isMatchEvent(event: AllGameEvents): event is MatchEvent {
  return !LOBBY_EVENT_TYPES.has(event.type);
}
