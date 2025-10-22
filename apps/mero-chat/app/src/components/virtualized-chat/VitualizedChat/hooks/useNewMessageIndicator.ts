import { useState, useCallback } from "react";

interface Message {
  id: string;
  timestamp: number;
}

interface UseNewMessageIndicatorProps<T extends Message> {
  isAtBottom: boolean;
  shouldTriggerNewItemIndicator?: (item: T) => boolean;
}

interface UseNewMessageIndicatorReturn {
  hasNewMessages: boolean;
  showNewMessageIndicator: () => void;
  hideNewMessageIndicator: () => void;
}

export function useNewMessageIndicator<T extends Message>({
  isAtBottom,
  shouldTriggerNewItemIndicator,
}: UseNewMessageIndicatorProps<T>): UseNewMessageIndicatorReturn {
  const [hasNewMessages, setHasNewMessages] = useState<boolean>(false);

  const showNewMessageIndicator = useCallback(() => {
    setHasNewMessages(true);
  }, []);

  const hideNewMessageIndicator = useCallback(() => {
    setHasNewMessages(false);
  }, []);

  return {
    hasNewMessages,
    showNewMessageIndicator,
    hideNewMessageIndicator,
  };
}
