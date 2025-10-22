import { useState, useRef, useCallback, useEffect } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import { log } from '../../../../utils/logger';

interface UseScrollManagerProps {
  chatId: string;
  isLoadingInitial: boolean;
  messageCount: number;
}

interface UseScrollManagerReturn {
  listRef: React.RefObject<VirtuosoHandle | null>;
  isAtBottom: boolean;
  scrollToBottom: () => void;
  handleFollowOutput: (atBottom: boolean) => 'smooth' | false;
  handleIsScrolling: (scrolling: boolean) => void;
  handleAtBottomStateChange: (atBottom: boolean) => void;
  hasScrolledToBottom: boolean;
  handleOwnMessageSent: () => void; // Directly scroll when sending message
}

export function useScrollManager({
  chatId,
  isLoadingInitial,
  messageCount,
}: UseScrollManagerProps): UseScrollManagerReturn {
  const listRef = useRef<VirtuosoHandle>(null);
  const isScrollingRef = useRef<boolean>(false);
  const isAtBottomRef = useRef<boolean>(true);
  const hasScrolledToBottomRef = useRef<boolean>(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSettlingRef = useRef<boolean>(false);
  const userHasScrolledAwayRef = useRef<boolean>(false); // Track if user intentionally left bottom
  const forceScrollOnNextOutputRef = useRef<boolean>(false); // Force scroll on next followOutput call
  
  const [isAtBottom, setIsAtBottom] = useState<boolean>(true);

  const clearScrollTimeout = useCallback(() => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
  }, []);

  const handleOwnMessageSent = useCallback(() => {
    // When user sends their own message, always scroll to bottom
    // Reset flags to enable auto-scroll
    userHasScrolledAwayRef.current = false;
    forceScrollOnNextOutputRef.current = true;
    
    log.debug('useScrollManager', 'Own message sent - scrolling to bottom');
    
    // Scroll immediately - Virtuoso handles the timing internally
    if (listRef.current) {
      listRef.current.scrollToIndex({
        index: 'LAST',
        behavior: 'smooth',
        align: 'end',
      });
    }
  }, []);

  const scrollToBottom = useCallback((): void => {
    // When user explicitly scrolls to bottom (like clicking button)
    // Reset flags to re-enable auto-scroll
    userHasScrolledAwayRef.current = false;
    forceScrollOnNextOutputRef.current = false;
    listRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' });
    log.debug('useScrollManager', 'Explicit scroll to bottom');
  }, []);

  const handleFollowOutput = useCallback((atBottom: boolean) => {
    // Force scroll if requested (e.g., when user sends their own message)
    // Keep the flag until we're actually at bottom to handle optimistic + real message
    if (forceScrollOnNextOutputRef.current) {
      log.debug('useScrollManager', 'Force scrolling to bottom');
      // Only clear flag once we've reached bottom
      if (atBottom) {
        forceScrollOnNextOutputRef.current = false;
        log.debug('useScrollManager', 'Force scroll completed - clearing flag');
      }
      return 'smooth';
    }
    
    // During settling period after initial load, don't interfere
    if (isSettlingRef.current) {
      return false;
    }
    
    // If user has scrolled away, NEVER auto-scroll (until they send a message)
    if (userHasScrolledAwayRef.current) {
      return false;
    }
    
    // Only auto-scroll if:
    // 1. We're at bottom
    // 2. User is not actively scrolling
    // 3. Bottom state confirms we're at bottom
    if (atBottom && !isScrollingRef.current && isAtBottomRef.current) {
      return 'smooth';
    }
    
    return false;
  }, []);

  const handleIsScrolling = useCallback((scrolling: boolean) => {
    isScrollingRef.current = scrolling;
    
    // If user starts scrolling after initial load, they're intentionally navigating
    if (scrolling && hasScrolledToBottomRef.current) {
      isSettlingRef.current = false;
      // Mark that user has taken control of scroll
      userHasScrolledAwayRef.current = true;
      // Clear force scroll flag when user manually scrolls
      forceScrollOnNextOutputRef.current = false;
      log.debug('useScrollManager', 'User is scrolling - disabled auto-scroll & force flag');
    }
  }, []);

  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    const wasAtBottom = isAtBottomRef.current;
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    
    // If user manually scrolls away from bottom after initial load
    if (!atBottom && wasAtBottom && hasScrolledToBottomRef.current) {
      isSettlingRef.current = false;
      userHasScrolledAwayRef.current = true;
      // Clear force scroll flag when user scrolls away
      forceScrollOnNextOutputRef.current = false;
      log.debug('useScrollManager', 'User scrolled away from bottom - cleared force flag');
    }
    
    // If user scrolls back to bottom manually, reset the flag
    if (atBottom && !wasAtBottom) {
      userHasScrolledAwayRef.current = false;
      log.debug('useScrollManager', 'User returned to bottom');
    }
    
    if (wasAtBottom !== atBottom) {
      log.debug('useScrollManager', `Bottom state changed: ${wasAtBottom} -> ${atBottom}`);
    }
  }, []);

  // Reset on chat change
  useEffect(() => {
    hasScrolledToBottomRef.current = false;
    isSettlingRef.current = false;
    userHasScrolledAwayRef.current = false; // Reset scroll-away flag
    forceScrollOnNextOutputRef.current = false; // Reset force scroll flag
    clearScrollTimeout();
  }, [chatId, clearScrollTimeout]);

  // Scroll to bottom after initial load
  useEffect(() => {
    if (!isLoadingInitial && messageCount > 0 && !hasScrolledToBottomRef.current) {
      isSettlingRef.current = true;
      clearScrollTimeout();
      
      scrollTimeoutRef.current = setTimeout(() => {
        if (listRef.current && !hasScrolledToBottomRef.current) {
          log.debug('useScrollManager', `Scrolling to bottom for chat ${chatId}`);
          listRef.current.scrollToIndex({ 
            index: 'LAST',
            align: 'end',
            behavior: 'auto'
          });
          hasScrolledToBottomRef.current = true;
          
          // Shorter settling period - just enough for initial render
          setTimeout(() => {
            isSettlingRef.current = false;
            log.debug('useScrollManager', 'Settling period complete');
          }, 500); // Reduced to 500ms for quicker response
        }
      }, 150);
      
      return clearScrollTimeout;
    }
  }, [isLoadingInitial, messageCount, chatId, clearScrollTimeout]);

  return {
    listRef,
    isAtBottom,
    scrollToBottom,
    handleFollowOutput,
    handleIsScrolling,
    handleAtBottomStateChange,
    hasScrolledToBottom: hasScrolledToBottomRef.current,
    handleOwnMessageSent,
  };
}

