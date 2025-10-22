import React, { useEffect, useRef, useCallback, memo } from 'react';
import { useCalimero } from '@calimero-network/calimero-client';
import { clearStoredSession, clearDmContextId, updateSessionActivity, clearSessionActivity } from '../utils/session';

/**
 * IdleTimeoutWrapper - Monitors user activity and automatically logs out inactive users
 * 
 * - Only activates when user is authenticated
 * - Monitors mouse, keyboard, scroll, and touch events
 * - Clears session data same as manual logout
 * - Configurable timeout (default: 1 hour)
 */
interface IdleTimeoutWrapperProps {
  children: React.ReactNode;
  timeoutMs?: number;
}

const IdleTimeoutWrapper = memo(function IdleTimeoutWrapper({ 
  children, 
  timeoutMs = 3600000 // 1 hour
}: IdleTimeoutWrapperProps) {
  const { isAuthenticated, logout } = useCalimero();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const handleLogout = useCallback(() => {
    clearStoredSession();
    clearDmContextId();
    clearSessionActivity();
    logout();
  }, [logout]);

  const resetTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    lastActivityRef.current = Date.now();

    if (isAuthenticated) {
      timeoutRef.current = setTimeout(() => {
        handleLogout();
      }, timeoutMs);
    }
  }, [isAuthenticated, timeoutMs, handleLogout]);

  const handleUserActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    updateSessionActivity(); // Update persistent session activity
    resetTimeout();
  }, [resetTimeout]);

  useEffect(() => {
    if (isAuthenticated) {
      // Essential events for both desktop and mobile
      // mousedown (desktop clicks), touchstart (mobile taps), keypress (typing), mousemove (mouse activity)
      const events = ['mousedown', 'touchstart', 'keypress', 'mousemove'];
      
      events.forEach(event => {
        document.addEventListener(event, handleUserActivity, { capture: true, passive: true });
      });

      resetTimeout();

      return () => {
        events.forEach(event => {
          document.removeEventListener(event, handleUserActivity, true);
        });
        
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
      };
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  }, [isAuthenticated, handleUserActivity, resetTimeout]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return <>{children}</>;
});

export default IdleTimeoutWrapper;
