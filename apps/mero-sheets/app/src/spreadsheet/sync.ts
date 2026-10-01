/**
 * What the status bar says about sync, from the node's own signals: whether
 * the browser can reach the node, whether a write is on its way, and the
 * node's sync phase for this workbook (its `SyncStatus` events: settled,
 * waiting for a peer, syncing, receiving a snapshot, or backing off after a
 * failure, with the reason).
 */

export type SyncPhase =
  | { state: 'idle' }
  | { state: 'waitingForPeers' }
  | { state: 'syncing' }
  | { state: 'receivingSnapshot'; percent?: number | null }
  | { state: 'backingOff'; retryInSecs?: number };

export interface SyncInfo {
  phase: SyncPhase;
  failureCount: number;
  lastError: string | null;
}

/** The sync status an event carries, or null for any other event. */
export function syncInfoFrom(event: { type?: string; data?: unknown }): SyncInfo | null {
  if (event.type !== 'SyncStatus') return null;
  const d = event.data as { syncState?: { state?: unknown; percent?: unknown; retryInSecs?: unknown }; failureCount?: unknown; lastError?: unknown } | undefined;
  const s = d?.syncState;
  const states = ['idle', 'waitingForPeers', 'syncing', 'receivingSnapshot', 'backingOff'];
  if (!s || typeof s.state !== 'string' || !states.includes(s.state)) return null;
  const phase = {
    state: s.state,
    ...(typeof s.percent === 'number' ? { percent: s.percent } : {}),
    ...(typeof s.retryInSecs === 'number' ? { retryInSecs: s.retryInSecs } : {}),
  } as SyncPhase;
  return {
    phase,
    failureCount: typeof d?.failureCount === 'number' ? d.failureCount : 0,
    lastError: typeof d?.lastError === 'string' ? d.lastError : null,
  };
}

export type SyncTone = 'ok' | 'busy' | 'warn' | 'off';

export interface SyncView {
  label: string;
  tone: SyncTone;
  /** A longer explanation, for the tooltip. */
  detail: string;
}

export function syncView({ connected, loaded, saving, info }: {
  connected: boolean;
  loaded: boolean;
  saving: boolean;
  info: SyncInfo | null;
}): SyncView {
  if (!connected) {
    return { label: 'Offline', tone: 'off', detail: 'Cannot reach your node. Changes resume when it is back.' };
  }
  if (!loaded) return { label: 'Loading…', tone: 'busy', detail: 'Reading the workbook from your node.' };
  if (saving) return { label: 'Saving…', tone: 'busy', detail: 'Writing your change to your node.' };
  switch (info?.phase.state) {
    case 'syncing':
      return { label: 'Syncing…', tone: 'busy', detail: 'Exchanging changes with peers.' };
    case 'receivingSnapshot': {
      const pct = info.phase.state === 'receivingSnapshot' ? info.phase.percent : null;
      return { label: pct != null ? `Syncing ${pct}%` : 'Syncing…', tone: 'busy', detail: 'Receiving the workbook from a peer.' };
    }
    case 'waitingForPeers':
      return { label: 'Waiting for a peer', tone: 'warn', detail: 'No other member is online to sync with yet. Your changes are saved on your node.' };
    case 'backingOff': {
      const retry = info.phase.state === 'backingOff' ? info.phase.retryInSecs : undefined;
      return {
        label: retry != null ? `Retrying in ${retry}s` : 'Retrying',
        tone: 'warn',
        detail: `${info.lastError ?? 'The last sync failed'}. Your changes are saved on your node.`,
      };
    }
    default:
      return { label: 'Up to date', tone: 'ok', detail: 'Saved on your node, and in sync with the peers it can reach.' };
  }
}
