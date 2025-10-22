import { useRef, useCallback, useEffect } from 'react';
import type { WebSocketEvent } from '../types/WebSocketTypes';
import { log } from '../utils/logger';

interface BatchConfig {
  /** Maximum time to wait before processing batch (ms) */
  maxWaitTime: number;
  /** Maximum number of events to batch together */
  maxBatchSize: number;
  /** Whether to prioritize certain event types */
  enablePriority?: boolean;
}

interface EventBatch {
  events: WebSocketEvent[];
  firstEventTime: number;
}

const DEFAULT_CONFIG: BatchConfig = {
  maxWaitTime: 100, // 100ms batch window
  maxBatchSize: 10,
  enablePriority: true,
};

/**
 * Custom hook for batching WebSocket events to reduce processing overhead
 * Groups multiple rapid events together and processes them in a single batch
 */
export function useWebSocketEventBatcher(
  processEvents: (events: WebSocketEvent[]) => Promise<void>,
  config: Partial<BatchConfig> = {}
) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  const eventBatchRef = useRef<EventBatch>({ events: [], firstEventTime: 0 });
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProcessingRef = useRef(false);

  /**
   * Process the current batch of events
   */
  const processBatch = useCallback(async () => {
    if (isProcessingRef.current || eventBatchRef.current.events.length === 0) {
      return;
    }

    isProcessingRef.current = true;
    const eventsToProcess = [...eventBatchRef.current.events];
    eventBatchRef.current = { events: [], firstEventTime: 0 };

    // Clear the timer
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }

    try {
      // Group events by type for optimized processing
      const eventsByType = new Map<string, WebSocketEvent[]>();
      
      for (const event of eventsToProcess) {
        const type = event.type || 'unknown';
        if (!eventsByType.has(type)) {
          eventsByType.set(type, []);
        }
        eventsByType.get(type)!.push(event);
      }

      log.debug('WebSocketBatcher', `Processing batch of ${eventsToProcess.length} events`, {
        totalEvents: eventsToProcess.length,
        eventTypes: Array.from(eventsByType.keys()),
        typeCounts: Object.fromEntries(
          Array.from(eventsByType.entries()).map(([type, events]) => [type, events.length])
        ),
      });

      // Process all events in the batch
      await processEvents(eventsToProcess);
    } catch (error) {
      log.error('WebSocketBatcher', 'Error processing event batch', error);
    } finally {
      isProcessingRef.current = false;
    }
  }, [processEvents]);

  /**
   * Add event to batch
   */
  const addEvent = useCallback((event: WebSocketEvent) => {
    const now = Date.now();
    
    // If this is the first event in the batch, record the time
    if (eventBatchRef.current.events.length === 0) {
      eventBatchRef.current.firstEventTime = now;
    }

    // Add event to batch
    eventBatchRef.current.events.push(event);

    // Check if we should process immediately
    const shouldProcessNow =
      eventBatchRef.current.events.length >= finalConfig.maxBatchSize ||
      (now - eventBatchRef.current.firstEventTime >= finalConfig.maxWaitTime);

    if (shouldProcessNow) {
      // Process immediately
      processBatch();
    } else {
      // Schedule processing after maxWaitTime
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
      }
      
      batchTimerRef.current = setTimeout(() => {
        processBatch();
      }, finalConfig.maxWaitTime);
    }
  }, [processBatch, finalConfig.maxBatchSize, finalConfig.maxWaitTime]);

  /**
   * Flush any pending events immediately
   */
  const flush = useCallback(() => {
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    processBatch();
  }, [processBatch]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
      }
    };
  }, []);

  return {
    addEvent,
    flush,
  };
}

