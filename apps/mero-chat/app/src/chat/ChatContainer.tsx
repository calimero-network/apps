import { useCallback, useEffect, useRef, useState } from "react";
import { styled } from "styled-components";
import type {
  ActiveChat,
  ChatMessagesData,
  ChatMessagesDataWithOlder,
  CurbMessage,
  UpdatedMessages,
} from "../types/Common";
import { DMSetupState } from "../types/Common";
import JoinChannel from "./JoinChannel";
import ChatDisplaySplit from "./ChatDisplaySplit";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import {
  apiClient,
  getExecutorPublicKey,
  type ResponseData,
} from "@calimero-network/calimero-client";
import type { ChannelInfo, DMChatInfo, UserId } from "../api/clientApi";
import HandleDMSetup from "./HandleDMSetup";
import HandleInvitation from "./HandleInvitation";
import JoinContext from "./JoinContext";
import InvitationPending from "./InvitationPending";
import { getDMSetupState } from "../utils/dmSetupState";
import SyncWaiting from "./SyncWaiting";
import { extractAndAddMentions } from "../utils/mentions";

interface ChatContainerProps {
  activeChat: ActiveChat;
  setIsOpenSearchChannel: () => void;
  onJoinedChat: () => void;
  loadInitialChatMessages: () => Promise<ChatMessagesData>;
  incomingMessages: CurbMessage[];
  loadPrevMessages: (id: string) => Promise<ChatMessagesDataWithOlder>;
  loadInitialThreadMessages: (
    parentMessageId: string
  ) => Promise<ChatMessagesData>;
  incomingThreadMessages: CurbMessage[];
  loadPrevThreadMessages: (id: string) => Promise<ChatMessagesDataWithOlder>;
  updateCurrentOpenThread: (thread: CurbMessage | undefined) => void;
  openThread: CurbMessage | undefined;
  setOpenThread: (thread: CurbMessage | undefined) => void;
  currentOpenThreadRef: React.RefObject<CurbMessage | undefined>;
  onDMSelected: (dm?: DMChatInfo, sc?: ActiveChat) => void;
  membersList: Map<string, string>;
}

const ChatContainerWrapper = styled.div`
  display: flex;
  background-color: #0e0e10;
  @media (min-width: 1025px) {
    padding-left: 4px;
    height: calc(100vh - 81px);
  }
  @media (max-width: 1024px) {
    display: flex;
    flex-direction: column;
    padding-top: 42px;
  }
`;

// const ThreadWrapper = styled.div`
//   height: 100%;
//   flex: 1;
//   border-left: 2px solid #282933;
//   padding-left: 20px;
//   @media (max-width: 1024px) {
//     border-left: none;
//     position: fixed;
//     left: 0;
//     right: 0; /* Set both left and right to 0 to stretch to full width */
//     top: 50%; /* Vertically center the element */
//     transform: translateY(-50%); /* Center it vertically */
//     z-index: 30;
//     background-color: #0e0e10;
//   }
// `;

export default function ChatContainer({
  activeChat,
  setIsOpenSearchChannel,
  onJoinedChat,
  loadInitialChatMessages,
  incomingMessages,
  loadPrevMessages,
  // loadInitialThreadMessages,
  // incomingThreadMessages,
  // loadPrevThreadMessages,
  updateCurrentOpenThread,
  openThread,
  setOpenThread,
  currentOpenThreadRef,
  onDMSelected,
  membersList,
}: ChatContainerProps) {
  const [updatedMessages, setUpdatedMessages] = useState<UpdatedMessages[]>([]);
  const [_updatedThreadMessages, setUpdatedThreadMessages] = useState<
    UpdatedMessages[]
  >([]);
  const [isEmojiSelectorVisible, setIsEmojiSelectorVisible] = useState(false);
  const [channelMeta, setChannelMeta] = useState<ChannelInfo>(
    {} as ChannelInfo
  );
  const [openMobileReactions, setOpenMobileReactions] = useState("");
  const [messageWithEmojiSelector, setMessageWithEmojiSelector] =
    useState<CurbMessage | null>(null);

  useEffect(() => {
    const fetchChannelMeta = async () => {
      const channelMeta: ResponseData<ChannelInfo> =
        await new ClientApiDataSource().getChannelInfo({
          channel: { name: activeChat.name },
        });
      if (channelMeta.data) {
        setChannelMeta(channelMeta.data);
      }
    };
    fetchChannelMeta();
  }, [activeChat]);

  const activeChatRef = useRef(activeChat);
  const membersListRef = useRef(membersList);

  useEffect(() => {
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    membersListRef.current = membersList;
  }, [membersList]);

  const computeReaction = useCallback(
    (message: CurbMessage, reaction: string, sender: string) => {
      const accounts = message.reactions?.[reaction] ?? [];
      let update;
      if (accounts.includes(sender)) {
        update = accounts.filter((a: string) => a !== sender);
      } else {
        update = [...accounts, sender];
      }
      return { reactions: { ...message.reactions, [reaction]: update } };
    },
    []
  );

  const handleReaction = useCallback(
    async (message: CurbMessage, reaction: string, isThread: boolean) => {
      const isDM = activeChatRef.current?.type === "direct_message";
      const accountId = getExecutorPublicKey() ?? "";
      const accounts = message.reactions?.[reaction] ?? [];
      const isAdding = !(
        Array.isArray(accounts) && accounts.includes(accountId)
      );

      try {
        const response = await new ClientApiDataSource().updateReaction({
          messageId: message.id,
          emoji: reaction,
          userId: accountId,
          add: isAdding,
          is_dm: isDM,
          dm_identity: activeChatRef.current?.account,
        });
        if (response.data) {
          const updateFunction = (message: CurbMessage) =>
            computeReaction(message, reaction, accountId);
          if (isThread) {
            setUpdatedThreadMessages([
              { id: message.id, descriptor: { updateFunction } },
            ]);
          } else {
            setUpdatedMessages([
              { id: message.id, descriptor: { updateFunction } },
            ]);
          }
        }
      } catch (error) {
        console.error("Error updating reaction:", error);
      }
    },
    []
  );

  const getIconFromCache = useCallback(
    (_accountId: string): Promise<string | null> => {
      const fallbackImage = "https://i.imgur.com/e8buxpa.png";
      return Promise.resolve(fallbackImage);
    },
    []
  );

  const toggleEmojiSelector = useCallback(
    (message: CurbMessage) => {
      setMessageWithEmojiSelector(message);
      setIsEmojiSelectorVisible((prev) => !prev);
    },
    [setIsEmojiSelectorVisible]
  );

  const sendMessage = async (message: string, isThread: boolean) => {
    const isDM = activeChatRef.current?.type === "direct_message";

    const result = extractAndAddMentions(message, membersListRef.current);

    const mentions: UserId[] = [...result.userIdMentions];
    const usernames: string[] = [...result.usernameMentions];

    await new ClientApiDataSource().sendMessage({
      group: {
        name: (isDM ? "private_dm" : activeChatRef.current?.name) ?? "",
      },
      message,
      mentions,
      usernames,
      timestamp: Math.floor(Date.now() / 1000),
      is_dm: isDM,
      dm_identity: activeChatRef.current?.account,
      parent_message: isThread ? currentOpenThreadRef.current?.id : undefined,
    });

    if (isDM) {
      const fetchContextResponse = await apiClient
        .node()
        .getContext(activeChatRef.current?.contextId || "");
      await new ClientApiDataSource().updateDmHash({
        sender_id: getExecutorPublicKey() || "",
        other_user_id: activeChatRef.current?.name || "",
        new_hash: (fetchContextResponse.data?.rootHash as string) || "",
      });
    }

    if (isThread && currentOpenThreadRef.current) {
      const newThreadCount =
        (currentOpenThreadRef.current.threadCount ?? 0) + 1;
      const newThreadLastTimestamp = Math.floor(Date.now() / 1000);
      const update = [
        {
          id: currentOpenThreadRef.current.id,
          descriptor: {
            updateFunction: () => ({
              threadCount: newThreadCount,
              threadLastTimestamp: newThreadLastTimestamp,
            }),
          },
        },
      ];
      setUpdatedMessages(update);
      currentOpenThreadRef.current = {
        ...currentOpenThreadRef.current,
        threadCount: newThreadCount,
        threadLastTimestamp: newThreadLastTimestamp,
      };
      setOpenThread(currentOpenThreadRef.current);
      updateCurrentOpenThread(currentOpenThreadRef.current);
    }
  };

  const updateDeletedMessage = (message: CurbMessage) => {
    const update = [
      { id: message.id, descriptor: { updatedFields: { deleted: true } } },
    ];
    setUpdatedMessages(update);
  };

  const handleDeleteMessage = useCallback(
    async (message: CurbMessage) => {
      const isDM = activeChatRef.current?.type === "direct_message";
      const response = await new ClientApiDataSource().deleteMessage({
        group: { name: activeChatRef.current?.name ?? "" },
        messageId: message.id,
        is_dm: isDM,
        dm_identity: activeChatRef.current?.account,
      });
      if (response.data) {
        updateDeletedMessage(message);
      }
    },
    // TODO
    [activeChatRef, currentOpenThreadRef]
  );

  const handleEditMode = useCallback(
    (message: CurbMessage) => {
      const update = [
        {
          id: message.id,
          descriptor: {
            updatedFields: { editMode: !message.editMode },
          },
        },
      ];
      // TODO
      setUpdatedMessages(update);
    },
    [currentOpenThreadRef]
  );

  const handleEditedMessage = useCallback(
    async (message: CurbMessage) => {
      const isDM = activeChatRef.current?.type === "direct_message";
      const editedOn = Math.floor(Date.now() / 1000);
      const response = await new ClientApiDataSource().editMessage({
        group: { name: activeChatRef.current?.name ?? "" },
        messageId: message.id,
        newMessage: message.text,
        timestamp: editedOn,
        is_dm: isDM,
        dm_identity: activeChatRef.current?.account,
      });
      if (response.data) {
        const update = [
          {
            id: message.id,
            descriptor: {
              updatedFields: {
                text: message.text,
                editMode: false,
                editedOn: editedOn,
              },
            },
          },
        ];
        setUpdatedMessages(update);
        // TODO
      }
    },
    [activeChatRef, currentOpenThreadRef]
  );

  const selectThread = (message: CurbMessage) => {
    setOpenThread(message);
    updateCurrentOpenThread(message);
    setUpdatedThreadMessages([]);
  };

  const dmSetupState = getDMSetupState(activeChat);

  const renderDMContent = () => {
    switch (dmSetupState) {
      case DMSetupState.CREATOR_WAITING_FOR_INVITEE_TO_CREATE_IDENTITY:
      case DMSetupState.INVITEE_CONTEXT_CREATE_IDENTITY:
        return (
          <HandleDMSetup activeChat={activeChat} onDMSelected={onDMSelected} />
        );
      case DMSetupState.CREATOR_CONTEXT_INVITATION_POPUP:
        return (
          <HandleInvitation
            activeChat={activeChat}
            onDMSelected={onDMSelected}
          />
        );
      case DMSetupState.INVITEE_WAITING_INVITATION:
        return <InvitationPending activeChat={activeChat} />;
      case DMSetupState.INVITEE_CONTEXT_ACCEPT_POPUP:
        return (
          <JoinContext
            activeChat={activeChat}
            invitationPayload={activeChat.invitationPayload!}
            onDMSelected={onDMSelected}
          />
        );
      case DMSetupState.SYNC_WAITING:
        return (
          <SyncWaiting activeChat={activeChat} onDMSelected={onDMSelected} />
        );

      case DMSetupState.ACTIVE:
        return (
          <ChatDisplaySplit
            readMessage={() => {}}
            handleReaction={handleReaction}
            openThread={openThread}
            setOpenThread={selectThread}
            activeChat={activeChat}
            updatedMessages={updatedMessages}
            resetImage={() => {}}
            sendMessage={(message: string) => sendMessage(message, false)}
            getIconFromCache={getIconFromCache}
            isThread={false}
            isReadOnly={activeChat.readOnly ?? false}
            toggleEmojiSelector={toggleEmojiSelector}
            channelMeta={channelMeta}
            //channelUserList={channelUserList}
            openMobileReactions={openMobileReactions}
            setOpenMobileReactions={setOpenMobileReactions}
            onMessageDeletion={handleDeleteMessage}
            onEditModeRequested={handleEditMode}
            onEditModeCancelled={handleEditMode}
            onMessageUpdated={handleEditedMessage}
            loadInitialChatMessages={loadInitialChatMessages}
            incomingMessages={incomingMessages}
            loadPrevMessages={loadPrevMessages}
            isEmojiSelectorVisible={isEmojiSelectorVisible}
            setIsEmojiSelectorVisible={setIsEmojiSelectorVisible}
            messageWithEmojiSelector={messageWithEmojiSelector}
          />
        );

      default:
        return null;
    }
  };

  return (
    <ChatContainerWrapper>
      {activeChat.type === "direct_message" ? (
        renderDMContent()
      ) : (
        <>
          {activeChat.canJoin ? (
            <JoinChannel
              channelMeta={channelMeta}
              activeChat={activeChat}
              setIsOpenSearchChannel={setIsOpenSearchChannel}
              onJoinedChat={onJoinedChat}
            />
          ) : (
            <ChatDisplaySplit
              readMessage={() => {}}
              handleReaction={handleReaction}
              openThread={openThread}
              setOpenThread={selectThread}
              activeChat={activeChat}
              updatedMessages={updatedMessages}
              resetImage={() => {}}
              sendMessage={(message: string) => sendMessage(message, false)}
              getIconFromCache={getIconFromCache}
              isThread={false}
              isReadOnly={activeChat.readOnly ?? false}
              toggleEmojiSelector={toggleEmojiSelector}
              channelMeta={channelMeta}
              //channelUserList={channelUserList}
              openMobileReactions={openMobileReactions}
              setOpenMobileReactions={setOpenMobileReactions}
              onMessageDeletion={handleDeleteMessage}
              onEditModeRequested={handleEditMode}
              onEditModeCancelled={handleEditMode}
              onMessageUpdated={handleEditedMessage}
              loadInitialChatMessages={loadInitialChatMessages}
              incomingMessages={incomingMessages}
              loadPrevMessages={loadPrevMessages}
              isEmojiSelectorVisible={isEmojiSelectorVisible}
              setIsEmojiSelectorVisible={setIsEmojiSelectorVisible}
              messageWithEmojiSelector={messageWithEmojiSelector}
            />
          )}
        </>
      )}
    </ChatContainerWrapper>
  );
}

{
  /* {openThread && openThread.id && (
            <ThreadWrapper>
              <ChatDisplaySplit
                readMessage={() => {}}
                handleReaction={handleReaction}
                openThread={openThread}
                setOpenThread={setOpenThread}
                activeChat={activeChat}
                updatedMessages={updatedThreadMessages}
                resetImage={() => {}}
                sendMessage={(message: string) => sendMessage(message, true)}
                getIconFromCache={getIconFromCache}
                isThread={true}
                isReadOnly={activeChat.readOnly ?? false}
                toggleEmojiSelector={toggleEmojiSelector}
                channelMeta={channelMeta}
                channelUserList={channelUserList}
                openMobileReactions={openMobileReactions}
                setOpenMobileReactions={setOpenMobileReactions}
                onMessageDeletion={handleDeleteMessage}
                onEditModeRequested={handleEditMode}
                onEditModeCancelled={handleEditMode}
                onMessageUpdated={handleEditedMessage}
                loadInitialChatMessages={() =>
                  loadInitialThreadMessages(openThread.id)
                }
                incomingMessages={incomingThreadMessages}
                loadPrevMessages={loadPrevThreadMessages}
                currentOpenThreadRef={currentOpenThreadRef}
                isEmojiSelectorVisible={isEmojiSelectorVisible}
                setIsEmojiSelectorVisible={setIsEmojiSelectorVisible}
                messageWithEmojiSelector={messageWithEmojiSelector}
              />
            </ThreadWrapper>
          )} */
}
