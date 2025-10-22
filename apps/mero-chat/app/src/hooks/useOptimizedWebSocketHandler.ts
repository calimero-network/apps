import { useCallback, useRef } from "react";
import type { WebSocketEvent } from "../types/WebSocketTypes";
import { log } from "../utils/logger";
import { coalesceStateMutations } from "../utils/websocketFilters";

interface EventStats {
  totalProcessed: number;
  totalSkipped: number;
  totalBatched: number;
  lastProcessTime: number;
  averageProcessTime: number;
}

interface OptimizedHandlerConfig {
  /** Enable event batching */
  enableBatching?: boolean;
  /** Batch window in ms */
  batchWindow?: number;
  /** Maximum batch size */
  maxBatchSize?: number;
  /** Enable performance metrics */
  enableMetrics?: boolean;
}

const DEFAULT_CONFIG: Required<OptimizedHandlerConfig> = {
  enableBatching: true,
  batchWindow: 100,
  maxBatchSize: 10,
  enableMetrics: true,
};

/**
 * Optimized WebSocket event handler with batching and metrics
 */
export function useOptimizedWebSocketHandler(
  onStateMutation: (event: WebSocketEvent) => Promise<void>,
  onExecutionEvent: (event: WebSocketEvent) => Promise<void>,
  config: OptimizedHandlerConfig = {},
) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  const eventBatchRef = useRef<WebSocketEvent[]>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isProcessingRef = useRef(false);
  const lastEventIdRef = useRef<string>("");

  // Performance metrics
  const statsRef = useRef<EventStats>({
    totalProcessed: 0,
    totalSkipped: 0,
    totalBatched: 0,
    lastProcessTime: 0,
    averageProcessTime: 0,
  });

  /**
   * Process a batch of events efficiently
   */
  const processBatch = useCallback(async () => {
    if (isProcessingRef.current || eventBatchRef.current.length === 0) {
      return;
    }

    const startTime = performance.now();
    isProcessingRef.current = true;

    const eventsToProcess = [...eventBatchRef.current];
    eventBatchRef.current = [];

    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }

    try {
      // Coalesce StateMutations (only keep the latest since they trigger full refresh)
      const coalescedEvents = coalesceStateMutations(eventsToProcess);

      const batchedCount = eventsToProcess.length - coalescedEvents.length;
      if (batchedCount > 0 && finalConfig.enableMetrics) {
        log.debug(
          "WebSocketHandler",
          `Coalesced ${batchedCount} redundant events`,
        );
        statsRef.current.totalBatched += batchedCount;
      }

      // Group remaining events by type
      const stateMutations: WebSocketEvent[] = [];
      const executionEvents: WebSocketEvent[] = [];

      for (const event of coalescedEvents) {
        if (event.type === "StateMutation") {
          stateMutations.push(event);
        } else if (event.type === "ExecutionEvent") {
          executionEvents.push(event);
        }
      }

      // Process state mutations (most common)
      if (stateMutations.length > 0) {
        await onStateMutation(stateMutations[stateMutations.length - 1]);
      }

      // Process execution events
      if (executionEvents.length > 0) {
        for (const event of executionEvents) {
          await onExecutionEvent(event);
        }
      }

      if (finalConfig.enableMetrics) {
        const endTime = performance.now();
        const processTime = endTime - startTime;

        statsRef.current.totalProcessed += eventsToProcess.length;
        statsRef.current.lastProcessTime = processTime;
        statsRef.current.averageProcessTime =
          statsRef.current.averageProcessTime * 0.9 + processTime * 0.1; // Moving average

        if (processTime > 100) {
          log.warn(
            "WebSocketHandler",
            `Slow batch processing: ${processTime.toFixed(2)}ms for ${eventsToProcess.length} events`,
          );
        }
      }
    } catch (error) {
      log.error("WebSocketHandler", "Error processing event batch", error);
    } finally {
      isProcessingRef.current = false;
    }
  }, [onStateMutation, onExecutionEvent, finalConfig.enableMetrics]);

  /**
   * Handle a single event with smart batching
   */
  const handleEvent = useCallback(
    (event: WebSocketEvent) => {
      const now = Date.now();
      const eventId = `${event.type}-${event.data?.timestamp || now}`;

      // Skip duplicate events
      if (lastEventIdRef.current === eventId) {
        if (finalConfig.enableMetrics) {
          statsRef.current.totalSkipped++;
        }
        return;
      }
      lastEventIdRef.current = eventId;

      if (!finalConfig.enableBatching) {
        // Process immediately without batching
        if (event.type === "StateMutation") {
          onStateMutation(event);
        } else if (event.type === "ExecutionEvent") {
          onExecutionEvent(event);
        }
        return;
      }

      // Add to batch
      eventBatchRef.current.push(event);

      // Check if we should process immediately
      const shouldProcessNow =
        eventBatchRef.current.length >= finalConfig.maxBatchSize;

      if (shouldProcessNow) {
        processBatch();
      } else {
        // Schedule batch processing
        if (batchTimerRef.current) {
          clearTimeout(batchTimerRef.current);
        }

        batchTimerRef.current = setTimeout(() => {
          processBatch();
        }, finalConfig.batchWindow);
      }
    },
    [onStateMutation, onExecutionEvent, processBatch, finalConfig],
  );

  /**
   * Get performance statistics
   */
  const getStats = useCallback(() => {
    return { ...statsRef.current };
  }, []);

  /**
   * Reset performance statistics
   */
  const resetStats = useCallback(() => {
    statsRef.current = {
      totalProcessed: 0,
      totalSkipped: 0,
      totalBatched: 0,
      lastProcessTime: 0,
      averageProcessTime: 0,
    };
  }, []);

  return {
    handleEvent,
    getStats,
    resetStats,
  };
}
