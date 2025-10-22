import { useState, useCallback, useRef } from 'react';
import type { ExecutionEventKind } from '../types/WebSocketTypes';
import { log } from '../utils/logger';

/**
 * Hook for managing state that only updates on specific events
 * This prevents unnecessary re-renders when unrelated events occur
 */

interface StateUpdateConfig<T> {
  /** Initial state value */
  initialState: T;
  /** Events that should trigger updates for this state */
  triggerEvents: ExecutionEventKind[];
  /** Function to fetch fresh data when triggered */
  fetchData: () => Promise<T>;
  /** Optional: Debounce time in ms */
  debounceMs?: number;
}

export function useEventSpecificState<T>(config: StateUpdateConfig<T>) {
  const [state, setState] = useState<T>(config.initialState);
  const [isLoading, setIsLoading] = useState(false);
  const lastUpdateRef = useRef<number>(0);
  const pendingUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Check if this event should trigger an update
   */
  const shouldUpdate = useCallback((eventKind: ExecutionEventKind): boolean => {
    return config.triggerEvents.includes(eventKind);
  }, [config.triggerEvents]);

  /**
   * Trigger an update if the event matches
   */
  const handleEvent = useCallback(async (eventKind: ExecutionEventKind) => {
    if (!shouldUpdate(eventKind)) {
      return; // Skip - this event doesn't affect our state
    }

    const now = Date.now();
    const debounceMs = config.debounceMs || 0;

    // Clear any pending update
    if (pendingUpdateRef.current) {
      clearTimeout(pendingUpdateRef.current);
    }

    // If debouncing, schedule the update
    if (debounceMs > 0) {
      pendingUpdateRef.current = setTimeout(async () => {
        await executeUpdate();
      }, debounceMs);
    } else {
      await executeUpdate();
    }

    async function executeUpdate() {
      // Check if we recently updated (prevent rapid successive updates)
      if (now - lastUpdateRef.current < (config.debounceMs || 0)) {
        return;
      }

      setIsLoading(true);
      lastUpdateRef.current = now;

      try {
        const newData = await config.fetchData();
        setState(newData);
      } catch (error) {
        log.error('EventSpecificState', 'Failed to update state', error);
      } finally {
        setIsLoading(false);
      }
    }
  }, [shouldUpdate, config]);

  /**
   * Manually refresh the state
   */
  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const newData = await config.fetchData();
      setState(newData);
      lastUpdateRef.current = Date.now();
    } catch (error) {
      log.error('EventSpecificState', 'Failed to refresh state', error);
    } finally {
      setIsLoading(false);
    }
  }, [config]);

  return {
    state,
    isLoading,
    handleEvent,
    refresh,
  };
}

/**
 * Example usage:
 * 
 * const channels = useEventSpecificState({
 *   initialState: [],
 *   triggerEvents: ['ChannelCreated', 'ChannelJoined', 'ChannelLeft'],
 *   fetchData: async () => await fetchChannels(),
 *   debounceMs: 1000,
 * });
 * 
 * // In event handler:
 * channels.handleEvent(event.kind);
 * 
 * // In component:
 * <ChannelList channels={channels.state} />
 */

