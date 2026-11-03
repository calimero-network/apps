import { useEffect, useMemo, useRef, useState } from 'react';
import type { CalimeroClient } from '@calimero-network/mero-js';
import type { AllGameEvents } from '../types/events';
import { isLobbyEvent } from '../types/events';

export interface UseGameSubscriptionsOptions {
  /** The client to stream with, once signed in. */
  client: Pick<CalimeroClient, 'events'> | null;
  /** The lobby's app instance: every lobby and match event comes from it. */
  appId: string | null;
  /**
   * The log index to stream from: one past the newest answer this page has
   * read, so the stream does not replay the lobby's history.
   */
  fromIndex: () => number;
  /** The open match; its events pass, other matches' do not. */
  matchId?: string;
  onBoardUpdate?: () => void;
  onTurnUpdate?: () => void;
  onGameEvent?: (event: AllGameEvents) => void;
}

export interface UseGameSubscriptionsReturn {
  isSubscribed: boolean;
  lastEvent: AllGameEvents | null;
}

/** How long to wait before opening the stream again after it closed. */
const RECONNECT_MS = 2_000;

type GameEventRefreshMode = 'none' | 'debounced' | 'immediate';

type ExecutionEventRecord = {
  kind?: unknown;
  data?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function decodeExecutionPayload(value: unknown): unknown {
  if (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'number')
  ) {
    try {
      return JSON.parse(new TextDecoder().decode(new Uint8Array(value)));
    } catch {
      return value;
    }
  }

  return value;
}

function toGameEvent(
  eventType: unknown,
  payload: unknown,
): AllGameEvents | null {
  if (typeof eventType !== 'string' || !isRecord(payload)) {
    return null;
  }

  const id = typeof payload.id === 'string' ? payload.id : '';

  switch (eventType) {
    case 'MatchCreated':
      return id ? { type: 'MatchCreated', id } : null;
    case 'ShipsPlaced':
      return id ? { type: 'ShipsPlaced', id } : null;
    case 'ShotProposed': {
      const { x, y } = payload;
      if (!id || typeof x !== 'number' || typeof y !== 'number') {
        return null;
      }

      return { type: 'ShotProposed', id, x, y };
    }
    case 'ShotFired': {
      const { x, y, result } = payload;
      if (
        !id ||
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        typeof result !== 'string'
      ) {
        return null;
      }

      return { type: 'ShotFired', id, x, y, result };
    }
    case 'Winner':
      return id ? { type: 'Winner', id } : null;
    case 'MatchEnded':
      return id ? { type: 'MatchEnded', id } : null;
    case 'MatchListUpdated':
      return { type: 'MatchListUpdated', id };
    case 'PlayerStatsUpdated':
      return { type: 'PlayerStatsUpdated', id };
    case 'PlayersUpdated':
      return { type: 'PlayersUpdated', id };
    case 'BoardCommitted': {
      const player = typeof payload.player === 'string' ? payload.player : '';
      const commitment =
        typeof payload.commitment === 'string' ? payload.commitment : '';
      if (!id || !player || !commitment) return null;
      return { type: 'BoardCommitted', id, player, commitment };
    }
    case 'BoardRevealed': {
      const player = typeof payload.player === 'string' ? payload.player : '';
      if (!id || !player) return null;
      return { type: 'BoardRevealed', id, player };
    }
    case 'RevealRequested':
      return id ? { type: 'RevealRequested', id } : null;
    case 'AuditPassed': {
      const player = typeof payload.player === 'string' ? payload.player : '';
      if (!id || !player) return null;
      return { type: 'AuditPassed', id, player };
    }
    case 'AuditFailed': {
      const player = typeof payload.player === 'string' ? payload.player : '';
      const reason = typeof payload.reason === 'string' ? payload.reason : '';
      if (!id || !player || !reason) return null;
      return { type: 'AuditFailed', id, player, reason };
    }
    default:
      return null;
  }
}

function parseExecutionEventRecord(value: unknown): AllGameEvents | null {
  if (!isRecord(value)) {
    return null;
  }

  const record = value as ExecutionEventRecord;
  return toGameEvent(record.kind, decodeExecutionPayload(record.data));
}

export function parseSubscriptionEvent(eventData: unknown): AllGameEvents | null {
  return parseSubscriptionEvents(eventData)[0] ?? null;
}

export function parseSubscriptionEvents(eventData: unknown): AllGameEvents[] {
  const directEvent = toGameEvent(
    isRecord(eventData) ? (eventData.type ?? eventData.event_type) : undefined,
    eventData,
  );
  if (directEvent) {
    return [directEvent];
  }

  if (!isRecord(eventData)) {
    return [];
  }

  const events = eventData.events;
  if (Array.isArray(events)) {
    const parsedEvents: AllGameEvents[] = [];
    for (const eventRecord of events) {
      const parsedEvent = parseExecutionEventRecord(eventRecord);
      if (parsedEvent) {
        parsedEvents.push(parsedEvent);
      }
    }

    return parsedEvents;
  }

  const parsedEvent = parseExecutionEventRecord(eventData);
  return parsedEvent ? [parsedEvent] : [];
}

export function matchesActiveMatch(
  activeMatchId: string | undefined,
  event: AllGameEvents,
): boolean {
  if (isLobbyEvent(event)) {
    return true;
  }

  if (activeMatchId === undefined) {
    return true;
  }

  if (activeMatchId.trim() === '') {
    return false;
  }

  return event.id === activeMatchId;
}

export function getGameEventEffects(event: AllGameEvents): {
  board: GameEventRefreshMode;
  turn: GameEventRefreshMode;
} {
  switch (event.type) {
    case 'MatchCreated':
    case 'ShipsPlaced':
    case 'Winner':
    case 'MatchEnded':
      return { board: 'debounced', turn: 'none' };
    // RevealRequested: the match just ended on the answers, and the board
    // refresh is what reveals this device's board; a reveal from the other
    // side changes the standing. Neither waits for the debounce.
    case 'ShotProposed':
    case 'ShotFired':
    case 'RevealRequested':
    case 'BoardRevealed':
      return { board: 'immediate', turn: 'immediate' };
    case 'MatchListUpdated':
    case 'PlayerStatsUpdated':
    case 'PlayersUpdated':
    case 'BoardCommitted':
    case 'AuditPassed':
    case 'AuditFailed':
      return { board: 'none', turn: 'none' };
    default: {
      const exhaustiveEvent: never = event;
      return exhaustiveEvent;
    }
  }
}

/**
 * The lobby's event stream (`client.events`), delivered as typed game events.
 *
 * v1 subscribed to two contexts (the lobby and the open match's game
 * context). A lobby is one app instance now, so one stream carries both;
 * match events are filtered to the open match by their `id`. When the stream
 * closes it is opened again from the newest index read, after re-reading the
 * boards and turn once, so nothing that happened in between is missed.
 */
export function useGameSubscriptions({
  client,
  appId,
  fromIndex,
  matchId,
  onBoardUpdate,
  onTurnUpdate,
  onGameEvent,
}: UseGameSubscriptionsOptions): UseGameSubscriptionsReturn {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [lastEvent, setLastEvent] = useState<AllGameEvents | null>(null);

  // The handlers change on every render of the match page; the stream must not.
  const handlers = useRef({ onBoardUpdate, onTurnUpdate, onGameEvent, matchId, fromIndex });
  handlers.current = { onBoardUpdate, onTurnUpdate, onGameEvent, matchId, fromIndex };
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const deliver = useMemo(
    () => (kind: string, data: unknown) => {
      const h = handlers.current;
      const event = toGameEvent(kind, data);
      if (!event || !matchesActiveMatch(h.matchId, event)) return;
      setLastEvent(event);
      const effects = getGameEventEffects(event);
      if (effects.board === 'immediate') {
        h.onBoardUpdate?.();
      } else if (effects.board === 'debounced') {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => handlers.current.onBoardUpdate?.(), 300);
      }
      if (effects.turn === 'immediate') h.onTurnUpdate?.();
      h.onGameEvent?.(event);
    },
    [],
  );

  useEffect(() => {
    if (!client || !appId) {
      setIsSubscribed(false);
      return undefined;
    }
    const abort = new AbortController();
    void (async () => {
      let first = true;
      while (!abort.signal.aborted) {
        if (!first) {
          // Whatever happened while the stream was down: read it once.
          handlers.current.onBoardUpdate?.();
          handlers.current.onTurnUpdate?.();
        }
        first = false;
        try {
          const from = handlers.current.fromIndex() + 1;
          setIsSubscribed(true);
          for await (const e of client.events(appId, from, abort.signal)) deliver(e.kind, e.data);
        } catch {
          // Closed: sign-out, the lobby left, the network. Opened again below.
        }
        setIsSubscribed(false);
        if (abort.signal.aborted) return;
        await new Promise((resolve) => setTimeout(resolve, RECONNECT_MS));
      }
    })();
    return () => {
      abort.abort();
      setIsSubscribed(false);
    };
  }, [client, appId, deliver]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  return { isSubscribed, lastEvent };
}
