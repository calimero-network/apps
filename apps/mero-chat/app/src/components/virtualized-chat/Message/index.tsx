import { useLongPress } from "@uidotdev/usehooks";
import { useEffect, useState, useMemo, memo } from "react";
import styled from "styled-components";

import { MessageActions } from "..";
import type { AccountData, CurbMessage } from "../types/curbTypes";
import { ElementPosition, MessageStatus } from "../types/curbTypes";
import { formatTimeAgo } from "../utils";

import { POPUP_POSITION_SWITCH_HEIGHT } from "./AutocompleteList";
import { Avatar } from "./Avatar";
import DeletedMessage from "./DeletedMessage";
import MessageSendingIcon from "./Icons/MessageSendingIcon";
import MessageSentIcon from "./Icons/MessageSentIcon";
import MessageEditor from "./MessageEditor";
import MessageEditorMobile from "./MessageEditorMobile";
// MessageFileField and MessageImageField removed - using our own versions
import MessageReactionsField from "./MessageReactionsField";
import RenderHtml from "./RenderHtml";
import ReplyContainerButton from "./ReplyContainerButton";

const ActionsContainer = styled.div`
  position: absolute;
  z-index: 30;
  top: 0rem;
  right: 1rem;
  visibility: hidden;
  opacity: 0;
`;

const ActionsContainerMobile = styled.div<{ $addPadding: boolean }>`
  display: none;
  @media (max-width: 1024px) {
    display: flex;
    position: absolute;
    z-index: 30;
    top: ${({ $addPadding }) => ($addPadding ? "-1rem" : "0rem")};
    right: 1rem;
  }
`;

const MessageContainer = styled.div<{ $editmode: boolean }>`
  width: 100%;
  border-radius: 4px;
  box-sizing: border-box;
  padding: 6px 0;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  @media (max-width: 1024px) {
    max-width: 1024px;
    font-size: 12px;
    font-style: normal;
    font-weight: 400;
    padding-left: 14px;
    padding-right: 14px;
  }
  ${({ $editmode }) => $editmode && "background-color: #0A131E;"}
  @media (min-width: 1025px) {
    &:hover ${ActionsContainer} {
      visibility: visible;
      ${({ $editmode }) => !$editmode && "opacity: 1;"}
    }
    &:hover {
      ${({ $editmode }) => !$editmode && "background-color: #1e1e1e;"}
    }
  }
`;

const SenderInfoContainer = styled.div`
  width: 100%;
  display: flex;
  align-items: center;
  column-gap: 0.5rem;
  display: flex;
  justify-content: flex-start;
`;

interface ProfileIconContainerProps {
  id?: string;
}

const ProfileIconContainerMsg = styled.div<ProfileIconContainerProps>`
  display: flex;
  justify-content: center;
  align-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  ${({ id }: ProfileIconContainerProps) => id && `background-color: #111;`}
  text-align: center;
  /* Body/Small */
  font-family: Helvetica Neue;
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 18px */
`;

const NameContainerSender = styled.div`
  display: flex;
  justify-content: start;
  align-items: center;
  width: 100%;
  color: #6c757d;
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  line-height: 100%;
`;

interface MessageTextProps {
  $globalMention: boolean;
  $accountId: string;
}

const MessageText = styled.div<MessageTextProps>`
  flex-grow: 1;
  flex-shrink: 1;
  overflow: hidden;
  word-wrap: break-word;
  padding-top: 0px;
  padding-left: 2rem;
  padding-right: 2rem;
  color: #fff;
  font-family: Helvetica Neue;
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  -webkit-font-smoothing: antialiased applied;

  @media (max-width: 1024px) {
    font-size: 12px;
    padding-right: 0;
  }

  background-color: ${(props) => props.$globalMention && "#ecfc910d"};

  .mention-everyone,
  .mention-here {
    background-color: #ecfc910d !important;
    color: #73b30c !important;
  }

  .mention-user-${(props: MessageTextProps) =>
    props.$accountId && `${props.$accountId}`} {
    color: #73b30c !important;
    background-color: #ecfc910d !important;
  }

  .mention {
    background-color: #73b30c;
  }

  .msg-content p {
    margin: 0 0 6px 0;
    padding: 0;
  }
  .msg-content ul,
  .msg-content ol {
    margin: 4px 0 6px 16px;
    padding: 0;
  }
  .msg-content li {
    margin: 2px 0;
    padding: 0;
  }
  .msg-content code {
    background: #1e1e1e;
    padding: 1px 4px;
    border-radius: 4px;
  }
  .msg-content pre {
    background: #111;
    padding: 8px;
    border-radius: 6px;
    overflow: auto;
  }
  .msg-content blockquote {
    margin: 6px 0;
    padding: 6px 10px 6px 10px;
    border-left: 3px solid #a5ff11;
    background: #111;
  }

  /* URL Link Styles */
  a,
  .url-link,
  .rich-text-link {
    cursor: pointer;
    text-decoration: none;
    color: #4e95ff;
    word-break: break-all;
  }

  a:hover,
  .url-link:hover,
  .rich-text-link:hover {
    color: #74abff;
    text-decoration: underline;
  }

  a:visited,
  .url-link:visited,
  .rich-text-link:visited {
    color: #4e95ff;
  }
  span {
    color: #fff !important;
  }
`;

const Tick = styled.div`
  padding-right: 2rem;
  width: 24px
  text-align: right;
  align-self: flex-end;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 2px;
  color: #777583;
  font-family: Helvetica Neue;
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
`;

const MessageContentContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const MessageTime = styled.div`
  padding-right: 2rem;
  color: #777583;
  font-family: Helvetica Neue;
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  line-height: 100%;
  @media (max-width: 1024px) {
    bottom: -1rem;
    right: 4px;
  }
`;

const FullScreenWrapper = styled.div`
  @media (min-width: 1025px) {
    display: none;
  }
  @media (max-width: 1024px) {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 20;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    -khtml-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
  }
`;

const ClosableBackground = styled.div`
  width: 100%;
  height: 100%;
  pointer-events: auto;
`;

const shouldShowHeader = (message: CurbMessage, prevMessage?: CurbMessage) => {
  if (!prevMessage) {
    return true; // No previous message
  }
  if (prevMessage.sender !== message.sender) {
    return true; // Different sender
  }
  if (
    (prevMessage.files.length === 0 &&
      prevMessage.images.length === 0 &&
      !prevMessage.text &&
      prevMessage.editedOn) ||
    prevMessage.deleted
  ) {
    return true; // Previous message was deleted or empty
  }
  // Group messages from same sender within 5 minutes
  const timeDiff = message.timestamp - prevMessage.timestamp;
  return timeDiff >= 300000; // 5 minutes or more between messages
};

interface MessageProps {
  message: CurbMessage;
  prevMessage?: CurbMessage;
  accountId: string;
  deletable?: boolean;
  editable?: boolean;
  handleReaction: (reaction: string) => void;
  openThread: () => void;
  getIconFromCache: (accountId: string) => Promise<string | null>;
  isThread: boolean;
  toggleEmojiSelector: () => void;
  editMessage: () => void;
  cancelEditMessage: () => void;
  deleteMessage: () => void;
  openMobileReactions: string;
  setOpenMobileReactions: (messageId: string) => void;
  submitEditedMessage: (text: string) => void;
  fetchAccounts: (prefix: string) => void;
  autocompleteAccounts: AccountData[];
  authToken: string | undefined;
  privateIpfsEndpoint: string;
}

const Message = (props: MessageProps) => {
  const text = props.message.text;
  const [screenSize, setScreenSize] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isMessageRectionListVisible, setIsMessageReactionListVisible] =
    useState(false);
  const [isMoreActionVisible, setIsMoreActionVisible] = useState(false);
  const [popupPosition, setPopupPosition] = useState<ElementPosition>(
    ElementPosition.TOP,
  );

  // Memoize the shouldShowHeader result to prevent multiple calculations
  const showHeader = useMemo(() => {
    return shouldShowHeader(props.message, props.prevMessage);
  }, [
    props.message.id,
    props.message.sender,
    props.message.timestamp,
    props.prevMessage?.id,
    props.prevMessage?.sender,
    props.prevMessage?.timestamp,
  ]);

  const [selectedReaction, setSelectedReaction] = useState<
    | {
        reaction: string;
        accounts: string[];
      }
    | undefined
  >(undefined);

  function openMessageReactionsList(
    reaction:
      | {
          reaction: string;
          accounts: string[];
        }
      | undefined,
  ) {
    setIsMessageReactionListVisible(true);
    setSelectedReaction(reaction);
  }

  function closeMessageReactionsList() {
    setIsMessageReactionListVisible(false);
    setSelectedReaction(undefined);
  }
  const attrs = useLongPress(() => {
    setIsOpen(!isOpen);
    props.setOpenMobileReactions(props.message.id);
  });

  if (
    (props.message.files.length === 0 &&
      props.message.images.length === 0 &&
      !props.message.text &&
      props.message.editedOn) ||
    props.message.deleted
  ) {
    return <DeletedMessage />;
  }

  // Memoize message status icon to prevent recreating on every render
  const statusIcon = useMemo(() => {
    return props.message.status === MessageStatus.sending ? (
      <MessageSendingIcon />
    ) : (
      <MessageSentIcon />
    );
  }, [props.message.status]);

  // Memoize formatted time to avoid recalculating on every render
  const formattedTime = useMemo(() => {
    return formatTimeAgo(props.message.timestamp / 1000, false);
  }, [props.message.timestamp]);

  // Memoize accountId transformation for CSS class names
  const escapedAccountId = useMemo(() => {
    return props.accountId.replace(/\./g, "\\.").replace(/_/g, "\\_");
  }, [props.accountId]);

  // Memoize global mention check
  const hasGlobalMention = useMemo(() => {
    return (
      text?.includes("mention-everyone") ||
      text?.includes("mention-here") ||
      text?.includes(`mention-user-${props.accountId}`)
    );
  }, [text, props.accountId]);

  useEffect(() => {
    const handleResize = () => {
      setScreenSize(window.innerWidth);
    };

    // Set initial size
    setScreenSize(window.innerWidth);

    // Add resize listener
    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []); // Empty deps - only run once on mount

  useEffect(() => {
    const container = document.getElementById(
      `actions-container-${props.message.id}`,
    );
    if (container) {
      const containerPositions = container.getBoundingClientRect();
      if (containerPositions.top < POPUP_POSITION_SWITCH_HEIGHT) {
        setPopupPosition(ElementPosition.BOTTOM);
      } else {
        setPopupPosition(ElementPosition.TOP);
      }
    }
  }, []);

  return (
    <>
      <MessageContainer
        {...attrs}
        $editmode={props.message?.editMode ? true : false}
      >
        <ActionsContainer id={`actions-container-${props.message.id}`}>
          <MessageActions
            editable={props.editable}
            deletable={props.deletable}
            toggleReaction={props.handleReaction}
            setThread={props.openThread}
            toggleEmojiSelector={props.toggleEmojiSelector}
            editMessage={props.editMessage}
            deleteMessage={props.deleteMessage}
            openMessageReactionsList={() => openMessageReactionsList(undefined)}
            isThread={props.isThread}
            isMoreActionVisible={isMoreActionVisible}
            setIsMoreActionVisible={setIsMoreActionVisible}
            popupPosition={popupPosition}
          />
        </ActionsContainer>
        {isOpen && props.openMobileReactions === props.message.id && (
          <FullScreenWrapper>
            <ClosableBackground
              onClick={() => {
                setIsOpen(false);
                props.setOpenMobileReactions("");
              }}
            ></ClosableBackground>
          </FullScreenWrapper>
        )}
        {isOpen && props.openMobileReactions === props.message.id && (
          <ActionsContainerMobile
            $addPadding={!shouldShowHeader(props.message, props.prevMessage)}
            id={`actions-container-${props.message.id}`}
          >
            <MessageActions
              editable={props.editable}
              deletable={props.deletable}
              toggleReaction={(emoji) => {
                props.handleReaction(emoji);
                setIsOpen(false);
              }}
              setThread={props.openThread}
              toggleEmojiSelector={props.toggleEmojiSelector}
              editMessage={props.editMessage}
              deleteMessage={props.deleteMessage}
              openMessageReactionsList={() =>
                openMessageReactionsList(undefined)
              }
              isThread={props.isThread}
              isMoreActionVisible={isMoreActionVisible}
              setIsMoreActionVisible={setIsMoreActionVisible}
              popupPosition={popupPosition}
            />
          </ActionsContainerMobile>
        )}
        {showHeader && (
          <SenderInfoContainer>
            <ProfileIconContainerMsg>
              <Avatar size="sm" name={props.message.senderUsername} />
            </ProfileIconContainerMsg>
            <NameContainerSender>
              {props.message.senderUsername}
            </NameContainerSender>
            <MessageTime>{formattedTime}</MessageTime>
          </SenderInfoContainer>
        )}
        {((props.message?.editMode && screenSize > 1024) ?? false) ? (
          <MessageEditor
            text={text}
            onSubmit={props.submitEditedMessage}
            onCancelEdit={props.cancelEditMessage}
            deleteMessage={props.deleteMessage}
            getIconFromCache={props.getIconFromCache}
            fetchAccounts={props.fetchAccounts}
            autocompleteAccounts={props.autocompleteAccounts}
          />
        ) : (
          <MessageContentContainer>
            <MessageText
              $globalMention={hasGlobalMention}
              $accountId={escapedAccountId}
            >
              <RenderHtml html={text} />
            </MessageText>
            <Tick>
              {props.message.editedOn && "(edited) "}
              {statusIcon}
            </Tick>
          </MessageContentContainer>
        )}
        {/* MessageImageField and MessageFileField components commented out - using versions from chat folder */}
        {/* {props.message.images.length > 0 && (
          <MessageImageField
            images={props.message.images}
            encryptionKey={props.message.key}
            nonce={props.message.nonce}
            authToken={props.authToken}
            privateIpfsEndpoint={props.privateIpfsEndpoint}
          />
        )}
        {props.message.files.length > 0 && (
          <div style={{ paddingTop: !!text ? '8px' : '0px' }}>
            <MessageFileField
              files={props.message.files}
              encryptionKey={props.message.key}
              nonce={props.message.nonce}
              authToken={props.authToken}
              privateIpfsEndpoint={props.privateIpfsEndpoint}
            />
          </div>
        )} */}
        {props.message.reactions && (
          <MessageReactionsField
            reactions={props.message.reactions}
            accountId={props.accountId}
            handleReaction={props.handleReaction}
            getIconFromCache={props.getIconFromCache}
            selectedReaction={selectedReaction}
            openMessageReactionsList={openMessageReactionsList}
            closeMessageReactionsList={closeMessageReactionsList}
            isMessageRectionListVisible={isMessageRectionListVisible}
          />
        )}
      </MessageContainer>
      {!props.isThread && (props.message.threadCount || 0) > 0 && (
        <ReplyContainerButton
          replyCount={props.message.threadCount ?? 0}
          lastTimestamp={(props.message.threadLastTimestamp ?? 0)}
          onClick={() => {
            props.openThread();
          }}
        />
      )}
      {props.message?.editMode && screenSize < 1025 && (
        <MessageEditorMobile
          text={text}
          onSubmit={props.submitEditedMessage}
          onCancelEdit={props.cancelEditMessage}
          deleteMessage={props.deleteMessage}
          getIconFromCache={props.getIconFromCache}
          fetchAccounts={props.fetchAccounts}
          autocompleteAccounts={props.autocompleteAccounts}
        />
      )}
    </>
  );
};

/**
 * Custom comparison function for React.memo
 * Only re-render if relevant props have changed
 */
const arePropsEqual = (
  prevProps: MessageProps,
  nextProps: MessageProps,
): boolean => {
  // If message IDs are different, definitely re-render
  if (prevProps.message.id !== nextProps.message.id) {
    return false;
  }

  // Check if message content changed
  if (
    prevProps.message.text !== nextProps.message.text ||
    prevProps.message.editMode !== nextProps.message.editMode ||
    prevProps.message.deleted !== nextProps.message.deleted ||
    prevProps.message.editedOn !== nextProps.message.editedOn ||
    prevProps.message.status !== nextProps.message.status ||
    prevProps.message.threadCount !== nextProps.message.threadCount ||
    prevProps.message.threadLastTimestamp !==
      nextProps.message.threadLastTimestamp
  ) {
    return false;
  }

  // Check reactions - deep comparison needed
  // Reactions is HashMap<string, string[]> (e.g., { "👍": ["user1", "user2"] })
  if (prevProps.message.reactions !== nextProps.message.reactions) {
    // If one is undefined/null and the other isn't
    if (!prevProps.message.reactions !== !nextProps.message.reactions) {
      return false;
    }
    // If both exist, check if they're different objects
    if (prevProps.message.reactions && nextProps.message.reactions) {
      const prevKeys = Object.keys(prevProps.message.reactions);
      const nextKeys = Object.keys(nextProps.message.reactions);

      // Check if number of reactions changed
      if (prevKeys.length !== nextKeys.length) {
        return false;
      }

      // Check if any reaction emoji or accounts changed
      for (const emoji of prevKeys) {
        const prevAccounts = prevProps.message.reactions[emoji];
        const nextAccounts = nextProps.message.reactions[emoji];

        if (!nextAccounts || prevAccounts.length !== nextAccounts.length) {
          return false;
        }
      }
    }
  }

  // Check if previous message changed (affects header display)
  if (
    prevProps.prevMessage?.id !== nextProps.prevMessage?.id ||
    prevProps.prevMessage?.sender !== nextProps.prevMessage?.sender ||
    prevProps.prevMessage?.timestamp !== nextProps.prevMessage?.timestamp ||
    prevProps.prevMessage?.deleted !== nextProps.prevMessage?.deleted
  ) {
    return false;
  }

  // Check if mobile reactions state changed for this message
  const prevIsOpen = prevProps.openMobileReactions === prevProps.message.id;
  const nextIsOpen = nextProps.openMobileReactions === nextProps.message.id;
  if (prevIsOpen !== nextIsOpen) {
    return false;
  }

  // Check if editable/deletable permissions changed
  if (
    prevProps.editable !== nextProps.editable ||
    prevProps.deletable !== nextProps.deletable
  ) {
    return false;
  }

  // Check if accountId changed (affects mentions)
  if (prevProps.accountId !== nextProps.accountId) {
    return false;
  }

  // Check if autocompleteAccounts changed (for edit mode)
  if (
    prevProps.autocompleteAccounts.length !==
    nextProps.autocompleteAccounts.length
  ) {
    return false;
  }

  // All other props are callbacks that should be stable
  // Don't compare them to avoid unnecessary re-renders
  return true;
};

export default memo(Message, arePropsEqual);

// const hasMention =
//   normalText.includes(`@${context.accountId}`) ||
//   normalText.includes('@everyone') ||
//   normalText.includes('@here');
// finalText = `
//   <style>
//     .mention {
//       color: #fff;
//       background-color: #343C93;
//     }
//     .mention-${context.accountId.replace(/[@.]/g, '-')} {
//       color: #FEAE37;
//       background-color: #83522F;
//     }
//     .url-link {
//       cursor: pointer;
//       text-decoration: none;
//       color: #4e95ff;
//       cursor: pointer;
//         }
//   .url-link:hover {
//       color: #74abff;
//       text-decoration: underline;
//     }
//   .url-link:visited {
//       color: #4e95ff;
//     }
//   .text-container {
//     color: #fff;
//     font-family: Helvetica Neue;
//     font-size: 16px;
//     font-style: normal;
//     font-weight: 400;
//     line-height: 150%;
//     padding-left: 2.5rem;
//     ${hasMention && 'background-color: rgba(131, 82, 47, 0.35);'}
//   }
//   ul {
//     padding-left: 1rem;
//     margin: 0;
//   }
//   ol {
//     padding-left: 1rem;
//     margin: 0;
//   }
//   .time-container {
//     position: absolute;
//     bottom: 0px;
//     right: 0px;
//     color: #777583;
//     font-family: Helvetica Neue;
//     font-size: 12px;
//     font-style: normal;
//     font-weight: 400;
//     line-height: 100%;
//     @media (max-width: 1024px) {
//       bottom: -1rem;
//       right: 4px;
//     }
//   }
//   </style>
//   <script>
//     const handleMessage = (text) => {
//       document.getElementById("text-container").innerHTML = text;
//     };
//     window.iFrameResizer = {
//       onMessage: handleMessage
//     }
//   </script>
//   <script type="text/javascript" src="https://cdnjs.cloudflare.com/ajax/libs/iframe-resizer/4.3.6/iframeResizer.contentWindow.js"></script>
//   <div class="text-container">
//   ${normalText}
//     <div class="time-container">
//       ${formatTimeAgo(props.message.timestamp / 1000, false)}
//     </div>
//   </div>
// `;
