import { useState, useEffect, useCallback, useRef } from 'react';
import { log } from '../utils/logger';

interface HealthStatus {
  isConnected: boolean;
  lastEventTime: number;
  missedHeartbeats: number;
  reconnectAttempts: number;
}

interface HealthMonitorConfig {
  /** Time without events before considering connection stale (ms) */
  heartbeatTimeout: number;
  /** Maximum reconnection attempts before giving up */
  maxReconnectAttempts: number;
  /** Initial reconnect delay (ms) */
  initialReconnectDelay: number;
  /** Maximum reconnect delay (ms) */
  maxReconnectDelay: number;
}

const DEFAULT_CONFIG: HealthMonitorConfig = {
  heartbeatTimeout: 60000, // 1 minute without events
  maxReconnectAttempts: 5,
  initialReconnectDelay: 1000, // Start with 1 second
  maxReconnectDelay: 30000, // Max 30 seconds
};

/**
 * Monitor WebSocket connection health and handle reconnections
 */
export function useWebSocketHealthMonitor(
  onReconnect: () => void,
  config: Partial<HealthMonitorConfig> = {}
) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  const [status, setStatus] = useState<HealthStatus>({
    isConnected: true,
    lastEventTime: Date.now(),
    missedHeartbeats: 0,
    reconnectAttempts: 0,
  });

  const statusRef = useRef(status);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep ref in sync
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  /**
   * Record that an event was received (connection is healthy)
   */
  const recordEvent = useCallback(() => {
    const now = Date.now();
    setStatus(prev => ({
      ...prev,
      isConnected: true,
      lastEventTime: now,
      missedHeartbeats: 0,
      reconnectAttempts: 0,
    }));
  }, []);

  /**
   * Attempt to reconnect with exponential backoff
   */
  const attemptReconnect = useCallback(() => {
    const attempts = statusRef.current.reconnectAttempts;
    
    if (attempts >= finalConfig.maxReconnectAttempts) {
      log.error('WebSocketHealth', 'Max reconnection attempts reached');
      setStatus(prev => ({ ...prev, isConnected: false }));
      return;
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      finalConfig.initialReconnectDelay * Math.pow(2, attempts),
      finalConfig.maxReconnectDelay
    );

    log.info('WebSocketHealth', `Reconnecting in ${delay}ms (attempt ${attempts + 1}/${finalConfig.maxReconnectAttempts})`);

    reconnectTimeoutRef.current = setTimeout(() => {
      setStatus(prev => ({
        ...prev,
        reconnectAttempts: prev.reconnectAttempts + 1,
      }));
      
      onReconnect();
    }, delay);
  }, [onReconnect, finalConfig]);

  /**
   * Check connection health periodically
   */
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastEvent = now - statusRef.current.lastEventTime;

      if (timeSinceLastEvent > finalConfig.heartbeatTimeout) {
        log.warn('WebSocketHealth', `No events received for ${timeSinceLastEvent}ms`);
        
        setStatus(prev => ({
          ...prev,
          missedHeartbeats: prev.missedHeartbeats + 1,
          isConnected: false,
        }));

        // Attempt reconnection after missing heartbeats
        if (statusRef.current.missedHeartbeats >= 2) {
          attemptReconnect();
        }
      }
    }, finalConfig.heartbeatTimeout / 2); // Check at half the timeout interval

    return () => clearInterval(interval);
  }, [finalConfig.heartbeatTimeout, attemptReconnect]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  return {
    status,
    recordEvent,
    isHealthy: status.isConnected && status.missedHeartbeats === 0,
  };
}

