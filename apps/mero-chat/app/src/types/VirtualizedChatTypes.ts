import type { AccountData, CurbMessage } from "curb-virtualized-chat";

export interface MessageRendererProps {
  accountId: string;
  isThread: boolean;
  handleReaction: (message: CurbMessage, reaction: string) => void;
  setThread?: (message: CurbMessage) => void;
  getIconFromCache: (accountId: string) => Promise<string | null>;
  toggleEmojiSelector: (message: CurbMessage) => void;
  openMobileReactions: string;
  setOpenMobileReactions: (messageId: string) => void;
  editable: (message: CurbMessage) => boolean;
  deleteable: (message: CurbMessage) => boolean;
  onEditModeRequested: (message: CurbMessage, isThread: boolean) => void;
  onEditModeCancelled: (message: CurbMessage) => void;
  onMessageUpdated: (message: CurbMessage) => void;
  onDeleteMessageRequested: (message: CurbMessage) => void;
  fetchAccounts: (prefix: string) => void;
  autocompleteAccounts: AccountData[];
  authToken: string | undefined;
  privateIpfsEndpoint: string;
}
