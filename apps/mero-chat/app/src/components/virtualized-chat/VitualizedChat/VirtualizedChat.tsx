import React, { useState, useCallback, useRef } from "react";
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
}

const VirtualizedChat = <T extends Message>({
  loadPrevMessages,
  loadInitialMessages,
  incomingMessages = [],
  updatedMessages = [],
  render,
  newMessageIndicator = DefaultNewMessageIndicator,
  onItemNewItemRender,
  shouldTriggerNewItemIndicator,
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
      {isLoadingInitial && <OverlayDiv type="loading" />}
      {!isLoadingInitial && messages?.length === 0 && <NoMessages />}
      {hasNewMessages && NewMessageIndicator}
      <ScrollToBottomButton
        show={!isAtBottom && messages.length > 0}
        onClick={scrollToBottom}
      />
      {!isLoadingInitial && messages.length > 0 && (
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
