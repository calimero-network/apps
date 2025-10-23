import { useEffect, useState, useRef } from "react";
import styled from "styled-components";
import { log } from "../utils/logger";

/**
 * WebSocket Status Indicator for Navbar
 * 
 * Shows a compact visual indicator of WebSocket connection health
 * Only visible in development mode
 */

interface WebSocketStatusProps {
  isSubscribed: boolean;
  contextId: string | null;
  subscriptionCount?: number;
}

const StatusContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.75rem;
  background-color: rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  border: 1px solid #282933;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background-color: rgba(255, 255, 255, 0.08);
    border-color: #3a3a4a;
  }

  @media (max-width: 768px) {
    padding: 0.25rem 0.5rem;
    gap: 0.375rem;
  }
`;

const StatusDot = styled.div<{ $status: "connected" | "idle" | "disconnected" }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: ${(props) => {
    if (props.$status === "connected") return "#4ade80";
    if (props.$status === "idle") return "#fbbf24";
    return "#9ca3af";
  }};
  animation: ${(props) => props.$status !== "disconnected" ? "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite" : "none"};

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
`;

const StatusText = styled.span`
  color: #e4e4e7;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;

  @media (max-width: 768px) {
    display: none;
  }
`;

const TooltipContainer = styled.div<{ $show: boolean }>`
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  background-color: #1a1a1f;
  border: 1px solid #282933;
  border-radius: 8px;
  padding: 0.75rem;
  min-width: 240px;
  max-width: 320px;
  max-height: 400px;
  overflow-y: auto;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  display: ${(props) => (props.$show ? "block" : "none")};
  
  /* Custom scrollbar */
  &::-webkit-scrollbar {
    width: 6px;
  }
  
  &::-webkit-scrollbar-track {
    background: #1a1a1f;
  }
  
  &::-webkit-scrollbar-thumb {
    background: #3a3a4a;
    border-radius: 3px;
  }
  
  &::-webkit-scrollbar-thumb:hover {
    background: #4a4a5a;
  }
`;

const TooltipRow = styled.div`
  display: flex;
  justify-content: space-between;
  color: #9ca3af;
  font-size: 11px;
  margin-bottom: 0.375rem;

  &:last-child {
    margin-bottom: 0;
  }

  span:first-child {
    color: #6b7280;
  }

  span:last-child {
    color: #e4e4e7;
    font-weight: 500;
  }
`;

const StatusWrapper = styled.div`
  position: relative;
`;

export function WebSocketStatus({ isSubscribed, contextId, subscriptionCount = 0 }: WebSocketStatusProps) {
  const [lastEventTime, setLastEventTime] = useState<number>(Date.now());
  const [eventCounts, setEventCounts] = useState<Record<string, number>>({});
  const [showTooltip, setShowTooltip] = useState(false);
  const lastEventRef = useRef<number>(Date.now());

  // Track WebSocket events globally (in dev mode)
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    // Intercept console.log to track WebSocket events
    const originalLog = console.log;
    const interceptor = (...args: unknown[]) => {
      const message = String(args[0] || "");
      if (message.includes("[WebSocket]") || message.includes("[DEBUG]")) {
        const now = Date.now();
        lastEventRef.current = now;
        setLastEventTime(now);
        
        // Extract event type from log message with detailed parsing
        let eventType = "Other";
        
        // Check for WebSocket-specific events
        if (message.includes("Event: ")) {
          const match = message.match(/Event: (\w+)/);
          if (match) eventType = match[1];
        } else if (message.includes("Subscribing to context")) {
          eventType = "Subscribe";
        } else if (message.includes("Unsubscribing from")) {
          eventType = "Unsubscribe";
        } else if (message.includes("Already subscribed")) {
          eventType = "Dup-Subscribe-Skip";
        } else if (message.includes("Processing batch")) {
          const batchMatch = message.match(/batch of (\d+)/);
          if (batchMatch) {
            eventType = `Batch(${batchMatch[1]})`;
          } else {
            eventType = "Batch";
          }
        } else if (message.includes("Switching WebSocket subscription")) {
          eventType = "Switch-Context";
        } else if (message.includes("Coalesced")) {
          eventType = "Coalesced-Events";
        } else if (message.includes("Failed to subscribe")) {
          eventType = "Error-Subscribe";
        } else if (message.includes("Failed to unsubscribe")) {
          eventType = "Error-Unsubscribe";
        } else if (message.includes("No events received")) {
          eventType = "Heartbeat-Warning";
        } else if (message.includes("[DEBUG]") && message.includes("[WebSocket]")) {
          // For generic debug messages, try to extract a meaningful label
          const parts = message.split("]");
          if (parts.length > 2) {
            const msgPart = parts[2].trim().substring(0, 30);
            eventType = `Debug: ${msgPart}`;
          } else {
            eventType = "Debug-Other";
          }
        }
        
        setEventCounts((prev) => ({
          ...prev,
          [eventType]: (prev[eventType] || 0) + 1,
        }));
      }
      originalLog.apply(console, args);
    };

    console.log = interceptor;

    return () => {
      console.log = originalLog;
    };
  }, []);

  // Only show in development
  if (!import.meta.env.DEV) {
    return null;
  }

  const timeSinceLastEvent = Date.now() - lastEventTime;
  const isStale = timeSinceLastEvent > 30000; // 30 seconds

  let status: "connected" | "idle" | "disconnected" = "connected";
  let statusText = "Connected";

  if (!isSubscribed) {
    status = "disconnected";
    statusText = "Disconnected";
  } else if (isStale) {
    status = "idle";
    statusText = "Idle";
  }

  return (
    <StatusWrapper
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <StatusContainer
        role="status"
        aria-label={`WebSocket status: ${statusText}`}
        title="Click for details"
      >
        <StatusDot $status={status} />
        <StatusText>WS: {statusText}</StatusText>
      </StatusContainer>

      <TooltipContainer $show={showTooltip}>
        <TooltipRow>
          <span>Status:</span>
          <span>{statusText}</span>
        </TooltipRow>
        <TooltipRow>
          <span>Subscriptions:</span>
          <span style={{ fontWeight: "600", color: subscriptionCount > 0 ? "#4ade80" : "#e4e4e7" }}>
            {subscriptionCount} {subscriptionCount === 1 ? "context" : "contexts"}
          </span>
        </TooltipRow>
        {contextId && (
          <TooltipRow>
            <span>Contexts:</span>
            <span style={{ fontSize: "9px", wordBreak: "break-all" }}>
              {contextId.split(", ").map(id => id.substring(0, 8)).join(", ")}...
            </span>
          </TooltipRow>
        )}
        <TooltipRow>
          <span>Last event:</span>
          <span>
            {timeSinceLastEvent < 1000
              ? "just now"
              : `${Math.floor(timeSinceLastEvent / 1000)}s ago`}
          </span>
        </TooltipRow>
        {Object.keys(eventCounts).length > 0 && (
          <>
            <div style={{ 
              borderTop: "1px solid #282933", 
              margin: "0.5rem 0 0.375rem 0",
              paddingTop: "0.375rem"
            }}>
              <span style={{ color: "#6b7280", fontSize: "10px", fontWeight: "600" }}>
                EVENT COUNTS
              </span>
            </div>
            {Object.entries(eventCounts)
              .sort(([, a], [, b]) => b - a) // Sort by count descending
              .map(([type, count]) => (
                <TooltipRow key={type}>
                  <span style={{ fontSize: "10px" }}>{type}:</span>
                  <span>{count}</span>
                </TooltipRow>
              ))}
            <div style={{ 
              borderTop: "1px solid #282933", 
              marginTop: "0.375rem",
              paddingTop: "0.375rem"
            }}>
              <TooltipRow>
                <span style={{ fontWeight: "600", color: "#e4e4e7" }}>Total:</span>
                <span style={{ fontWeight: "600", color: "#e4e4e7" }}>
                  {Object.values(eventCounts).reduce((sum, count) => sum + count, 0)}
                </span>
              </TooltipRow>
            </div>
          </>
        )}
      </TooltipContainer>
    </StatusWrapper>
  );
}

/**
 * Global WebSocket event tracker
 * Use this to log WebSocket events from anywhere in the app
 */
export const wsTracker = {
  trackEvent: (eventType: string, data?: unknown) => {
    log.debug("WebSocket", `Event: ${eventType}`, data);
  },
  
  trackSubscription: (contextId: string, action: "subscribe" | "unsubscribe") => {
    log.info("WebSocket", `${action === "subscribe" ? "Subscribed to" : "Unsubscribed from"}: ${contextId}`);
  },
  
  trackError: (error: unknown, context?: string) => {
    log.error("WebSocket", `Error${context ? ` in ${context}` : ""}`, error);
  },
};

