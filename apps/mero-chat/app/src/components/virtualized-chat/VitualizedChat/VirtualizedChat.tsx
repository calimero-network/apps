import React, { useState, useCallback, useEffect, useRef } from "react";
import type { ListRange } from "react-virtuoso";
import { Virtuoso } from "react-virtuoso";
import styled from "styled-components";

import DefaultNewMessageIndicator from "./DefaultNewMessagesIndicator";
import type { UpdateDescriptor } from "./MessageStore";
import MessageStore from "./MessageStore";
import NoMessages from "./NoMessages";
import { OverlayDiv } from "./OverlayDiv";
import LoadingHeader from "./LoadingHeader";
import ScrollToBottomButton from "./ScrollToBottomButton";
import {
  useMessageLoader,
  useScrollManager,
  useNewMessageIndicator,
  useMessageUpdates,
} from "./hooks";
import { VIRTUOSO_CONFIGS } from "./utils/virtuosoConfig";

const VirtuosoWrapper = styled.div`
  scrollbar-color: black transparent;
  ::-webkit-scrollbar {
    width: 6px;
  }
  ::-webkit-scrollbar-thumb {
    background-color: black;
    border-radius: 6px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background-color: black;
  }
  * {
    scrollbar-color: black transparent;
  }
  html::-webkit-scrollbar {
    width: 12px;
  }
  html::-webkit-scrollbar-thumb {
    background-color: black;
    border-radius: 6px;
  }
  html::-webkit-scrollbar-thumb:hover {
    background-color: black;
  }
`;

interface Message {
  id: string;
  timestamp: number;
}

interface NewMessageIndicatorProps {
  onClick: () => void;
}

export interface VirtualizedChatProps<T extends Message> {
  loadPrevMessages: (
    id: string,
  ) => Promise<{ messages: T[]; hasOlder: boolean }>;
  loadInitialMessages: () => Promise<{ messages: T[]; totalCount: number }>;
  incomingMessages?: T[];
  updatedMessages?: { id: string; descriptor: UpdateDescriptor<T> }[];
  render: (item: T, prevItem?: T) => React.ReactElement;
  newMessageIndicator?: React.ComponentType<NewMessageIndicatorProps>;
  onItemNewItemRender?: (item: T) => void;
  style?: React.CSSProperties;
  chatId: string;
  shouldTriggerNewItemIndicator?: (item: T) => boolean;
  /**
   * Id of a message to bring into view — the one a permalink pointed at.
   *
   * Addressed by id rather than position because the caller knows which
   * MESSAGE it wants, and its position in the loaded window shifts every time
   * older messages are prepended above it.
   */
  focusMessageId?: string | null;
  /** Bump to reload the initial window without changing channel. */
  reloadKey?: number;
}

/** How often to re-ask for the linked message once the first try misses. */
const FOCUS_SCROLL_RETRY_MS = 120;
/** Give up after ~1.5s rather than fighting the page indefinitely. */
const FOCUS_SCROLL_ATTEMPTS = 12;

const VirtualizedChat = <T extends Message>({
  loadPrevMessages,
  loadInitialMessages,
  incomingMessages = [],
  updatedMessages = [],
  render,
  newMessageIndicator = DefaultNewMessageIndicator,
  onItemNewItemRender,
  shouldTriggerNewItemIndicator,
  focusMessageId,
  reloadKey,
  style,
  chatId,
}: VirtualizedChatProps<T>): React.ReactElement => {
  // Initialize message store
  const store = useRef(new MessageStore<T>()).current;
  const [oldestMessageReported, setOldestMessageReported] =
    useState<number>(-1);

  // Memoize callbacks to prevent render loops
  const handleLoadComplete = useCallback(
    () => setOldestMessageReported(-1),
    [],
  );

  // Use custom hooks for separated concerns (KISS principle)
  const {
    messages,
    isLoadingInitial,
    isLoadingOlder,
    firstItemIndex,
    totalCount,
    handleLoadMore,
    updateMessages,
  } = useMessageLoader({
    chatId,
    reloadKey,
    loadInitialMessages,
    loadPrevMessages,
    store,
    onLoadComplete: handleLoadComplete,
  });

  const {
    listRef,
    isAtBottom,
    scrollToBottom,
    handleFollowOutput,
    handleIsScrolling,
    handleAtBottomStateChange,
    handleOwnMessageSent,
  } = useScrollManager({
    chatId,
    isLoadingInitial,
    messageCount: messages.length,
    // A linked message decides where the view sits, not the newest message.
    suppressInitialScroll: !!focusMessageId,
  });

  const { hasNewMessages, showNewMessageIndicator, hideNewMessageIndicator } =
    useNewMessageIndicator<T>({
      isAtBottom,
      shouldTriggerNewItemIndicator,
    });

  useMessageUpdates({
    incomingMessages,
    updatedMessages,
    store,
    isAtBottom,
    shouldTriggerNewItemIndicator,
    onMessagesUpdated: updateMessages,
    onNewMessagesWhileNotAtBottom: showNewMessageIndicator,
    onOwnMessageSent: handleOwnMessageSent, // Scroll when user sends message
  });

  // Track last rendered item for notifications
  const reportLastRenderedItem = useCallback(
    (range: ListRange) => {
      if (onItemNewItemRender && range.endIndex > oldestMessageReported) {
        const lastItem = store.getItem(range.endIndex - firstItemIndex);
        if (lastItem) {
          onItemNewItemRender(lastItem);
          setOldestMessageReported(range.endIndex);
        }
      }
    },
    [onItemNewItemRender, oldestMessageReported, store, firstItemIndex],
  );

  // Bring a linked message into view.
  //
  // Re-issued until the DOM says the message is actually visible, rather than
  // fired once and assumed. The first attempt necessarily runs before the list
  // has measured anything: every row is still its estimated
  // `defaultItemHeight` (80px) while real messages are nearer a third of that,
  // so "centre item 25" is computed against heights that are wrong and
  // overshoots — landing the linked message above the top of the pane, hidden
  // behind the header. Once rows are measured the same request lands correctly,
  // so the fix is to ask again until it does.
  const lastFocusedRef = useRef<string | null>(null);
  const scrollerElRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!focusMessageId) {
      lastFocusedRef.current = null;
      return;
    }
    if (lastFocusedRef.current === focusMessageId) return;

    const position = messages.findIndex((m) => m.id === focusMessageId);
    if (position < 0) return; // Not loaded yet; a later render will find it.
    lastFocusedRef.current = focusMessageId;

    /** Is the linked message inside the visible part of the list? */
    const isVisible = (): boolean => {
      const scroller = scrollerElRef.current;
      const row = scroller?.querySelector(`[data-index="${position}"]`);
      if (!scroller || !row) return false;
      const pane = scroller.getBoundingClientRect();
      const rect = row.getBoundingClientRect();
      return rect.top >= pane.top && rect.bottom <= pane.bottom;
    };

    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      if (isVisible()) return;
      listRef.current?.scrollToIndex({ index: position, align: "center" });
      attempts += 1;
      if (attempts < FOCUS_SCROLL_ATTEMPTS) {
        timer = setTimeout(attempt, FOCUS_SCROLL_RETRY_MS);
      }
    };
    attempt();

    return () => clearTimeout(timer);
  }, [focusMessageId, messages, listRef]);

  // Render individual message items
  // Memoized to prevent unnecessary re-renders (Virtuoso best practice)
  // Reference: https://virtuoso.dev/
  const handleRenderItem = useCallback(
    (index: number, item: T) => {
      const actualIndex = index - firstItemIndex;
      const currentMessages = store.messages;
      const prevMessage =
        actualIndex > 0 ? currentMessages[actualIndex - 1] : undefined;

      return render(item, prevMessage);
    },
    [render, firstItemIndex, store],
  );

  // Stable computeItemKey function (Virtuoso best practice for unique keys)
  // Similar to VirtuosoMessageList computeItemKey pattern
  // Reference: https://virtuoso.dev/virtuoso-message-list/tutorial/loading-older-messages/
  const handleComputeItemKey = useCallback(
    (_index: number, item: T) => store.computeKey(item),
    [store],
  );

  // Memoize custom components to prevent re-creation (Virtuoso best practice)
  // "Don't inline the custom components" - from VirtuosoMessageList docs
  const HeaderComponent = useCallback(
    () => <LoadingHeader isLoading={isLoadingOlder} />,
    [isLoadingOlder],
  );

  // Create new message indicator component
  const NewMessageIndicator = React.createElement(newMessageIndicator, {
    onClick: scrollToBottom,
  });

  return (
    <VirtuosoWrapper style={{ position: "relative", ...style }}>
      {isLoadingInitial && messages.length === 0 && <OverlayDiv type="loading" />}
      {!isLoadingInitial && messages?.length === 0 && <NoMessages />}
      {hasNewMessages && NewMessageIndicator}
      <ScrollToBottomButton
        show={!isAtBottom && messages.length > 0}
        onClick={scrollToBottom}
      />
      {messages.length > 0 && (
        <Virtuoso
          key={chatId}
          style={VIRTUOSO_CONFIGS.style}
          itemContent={handleRenderItem}
          computeItemKey={handleComputeItemKey}
          followOutput={handleFollowOutput}
          components={{
            Header: HeaderComponent,
          }}
          data={messages}
          alignToBottom
          initialTopMostItemIndex={messages.length - 1}
          startReached={handleLoadMore}
          endReached={hideNewMessageIndicator}
          rangeChanged={reportLastRenderedItem}
          firstItemIndex={firstItemIndex}
          totalCount={totalCount}
          isScrolling={handleIsScrolling}
          atBottomStateChange={handleAtBottomStateChange}
          atBottomThreshold={VIRTUOSO_CONFIGS.atBottomThreshold}
          ref={listRef}
          scrollerRef={(el) => {
            scrollerElRef.current =
              el && "scrollTop" in el ? (el as HTMLElement) : null;
          }}
          overscan={VIRTUOSO_CONFIGS.overscan}
          increaseViewportBy={VIRTUOSO_CONFIGS.viewport}
          defaultItemHeight={VIRTUOSO_CONFIGS.defaultItemHeight}
          skipAnimationFrameInResizeObserver={true}
        />
      )}
    </VirtuosoWrapper>
  );
};

export default VirtualizedChat;
