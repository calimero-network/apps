import { useCallback, useEffect, useRef, useState } from "react";
import { styled } from "styled-components";
import type {
  ActiveChat,
  ChannelMeta,
  ChatMessagesData,
  CurbMessage,
  MessageWithReactions,
  User,
} from "../types/Common";
import JoinChannel from "./JoinChannel";
import EmojiSelectorPopup from "../emojiSelector/EmojiSelectorPopup";
import ChatDisplaySplit from "./ChatDisplaySplit";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";

interface ChatContainerProps {
  activeChat: ActiveChat;
  setIsOpenSearchChannel: () => void;
  onJoinedChat: () => void;
  loadInitialChatMessages: () => Promise<ChatMessagesData>;
  incomingMessages: CurbMessage[];
}

const ChatContainerWrapper = styled.div`
  display: flex;
  @media (min-width: 1025px) {
    padding-left: 4px;
    height: calc(100vh - 169px);
  }
  @media (max-width: 1024px) {
    display: flex;
    flex-direction: column;
    padding-top: 104px;
  }
`;

const ThreadWrapper = styled.div`
  height: 100%;
  flex: 1;
  border-left: 2px solid #282933;
  padding-left: 20px;
  @media (max-width: 1024px) {
    border-left: none;
    position: fixed;
    left: 0;
    right: 0; /* Set both left and right to 0 to stretch to full width */
    top: 50%; /* Vertically center the element */
    transform: translateY(-50%); /* Center it vertically */
    z-index: 30;
    background-color: #0e0e10;
  }
`;

export default function ChatContainer({
  activeChat,
  setIsOpenSearchChannel,
  onJoinedChat,
  loadInitialChatMessages,
  incomingMessages,
}: ChatContainerProps) {
  const [openThread, setOpenThread] = useState<
    MessageWithReactions | undefined
  >(undefined);
  const [updatedMessages, _setUpdatedMessages] = useState<
    MessageWithReactions[]
  >([]);
  const [incomingThreadMessages, _setIncomingThreadMessages] = useState<
    MessageWithReactions[]
  >([]);
  const [updatedThreadMessages, _setUpdatedThreadMessages] = useState<
    MessageWithReactions[]
  >([]);
  const [isEmojiSelectorVisible, setIsEmojiSelectorVisible] = useState(false);
  const [messageWithEmojiSelector, _setMessageWithEmojiSelector] =
    useState<MessageWithReactions | null>(null);
  const [channelMeta, _setChannelMeta] = useState<ChannelMeta>(
    {} as ChannelMeta
  );
  const [channelUserList, _setChannelUserList] = useState<User[]>([]);
  const [openMobileReactions, setOpenMobileReactions] = useState("");

  useEffect(() => {
    if (activeChat.type === "channel") {
      // todo! get channel meta and channel members
      //curbApi.getChannelMeta(activeChat.name).then(setChannelMeta);
      //curbApi.getChannelMembers(activeChat.name).then(setChannelUserList);
    }
  }, [activeChat]);

  const _toggleEmojiSelector = useCallback(
    (message: string) => {
      console.log("message", message);
      setIsEmojiSelectorVisible((prev) => !prev);
    },
    [setIsEmojiSelectorVisible]
  );

  const activeChatRef = useRef(activeChat);
  const _openThreadRef = useRef(openThread);

  useEffect(() => {
    if (activeChat.type === "channel") {
      // todo: calimero ws subscription
      // wsApi.methods.subscribe(
      //   { [contract]: [activeChat.name] },
      //   (err, result) => {
      //     if (err) return console.log("error subscribing to channel", err);
      //     console.log("subscribed to", activeChat, err, result);
      //     curbApi.emit("subscribed", activeChat.name);
      //   }
      // );
    }
    activeChatRef.current = activeChat;
  }, [activeChat]);

  useEffect(() => {
    setOpenThread(undefined);
  }, [activeChat]);

  // useEffect(() => {
  //   _openThreadRef.current = openThread;
  // }, [openThread]);
  const computeReaction = useCallback(
    (message: MessageWithReactions, reaction: string, sender: string) => {
      const accounts = message.reactions.get(reaction) ?? [];
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

  // useEffect(() => {
  //   const messageListener = () => {};
  //   const reactionListener = () => {};
  //   const editsListener = () => {};
  //   const deleteListener = () => {};
  // }, []);

  // const readMessage = useCallback((message: MessageWithReactions) => {
  //   if (message?.id && message?.sender !== localStorage.getItem("accountId")) {
  //     // todo: api for read message
  //     // curbApi.readMessage({
  //     //   chat: activeChatRef.current,
  //     //   messageId: message.id,
  //     // });
  //   }
  // }, []);

  const handleReaction = useCallback(
    (message: MessageWithReactions, reaction: string) => {
      const _updates = [
        {
          id: message.id,
          descriptor: {
            updateFunction: (message: MessageWithReactions) =>
              computeReaction(
                message,
                reaction,
                localStorage.getItem("accountId") ?? ""
              ),
          },
        },
      ];
      //setUpdatedMessages(updates);
      //setUpdatedThreadMessages(updates);
      // todo toggle
      //curbApi.toggleReaction({ messageId: message.id, reaction });
    },
    []
  );

  // const submitMessage = (chat: ActiveChat, message: Message) =>
  //   new Promise((resolve, reject) => {
  //     // TODO SEND MESSAGE
  //     // curbApi.sendMessage(
  //     //   {
  //     //     message: message.text,
  //     //     chat,
  //     //     images: message.images,
  //     //     files: message.files,
  //     //     threadId: message.parent_message ? message.parent_message : undefined,
  //     //   },
  //     //   (err, result) => {
  //     //     if (result) {
  //     //       resolve(result.result.id);
  //     //     } else {
  //     //       reject(err);
  //     //     }
  //     //   }
  //     // );
  //   });

  // const createSendMessageHandler =
  //   (chat, parentMessage) => (text, img, uploadedFile) => {
  //     const temporalMessage = createTemporalMessage(
  //       text,
  //       img,
  //       uploadedFile,
  //       parentMessage
  //     );

  //     const incomingCall = parentMessage
  //       ? setIncomingThreadMessages
  //       : setIncomingMessages;
  //     incomingCall([temporalMessage]);

  //     submitMessage(chat, temporalMessage)
  //       .then((realMessageId) => {
  //         const update = [
  //           {
  //             id: temporalMessage.id,
  //             descriptor: {
  //               updatedFields: {
  //                 id: realMessageId,
  //                 temporalId: undefined,
  //                 status: "sent",
  //               },
  //             },
  //           },
  //         ];

  //         if (parentMessage) {
  //           const parentUpdate = [
  //             {
  //               id: parentMessage.id,
  //               descriptor: {
  //                 updateFunction: (message) => ({
  //                   threadCount: message.threadCount + 1,
  //                   threadLastTimestamp: Date.now(),
  //                 }),
  //               },
  //             },
  //           ];
  //           setUpdatedThreadMessages(update);
  //           setUpdatedMessages(parentUpdate);
  //         } else {
  //           setUpdatedMessages(update);
  //         }
  //       })
  //       .catch((err) => {
  //         console.log(err);
  //       });
  //   };

  // const sendMessage = useMemo(
  //   () => createSendMessageHandler(activeChat),
  //   [activeChat]
  // );
  // const sendThreadMessage = useMemo(
  //   () => createSendMessageHandler(activeChat, openThread),
  //   [activeChat, openThread]
  // );

  const getIconFromCache = useCallback((_accountId: string) => {
    const fallbackImage = "https://i.imgur.com/e8buxpa.png";
    return fallbackImage;
  }, []);

  // const updateDeletedMessage = ({ id, parent_message }) => {
  //   const update = [{ id, descriptor: { updatedFields: { deleted: true } } }];
  //   if (parent_message) {
  //     const parentUpdate = [
  //       {
  //         id: parent_message,
  //         descriptor: {
  //           updateFunction: (message) => ({
  //             threadCount: message.threadCount - 1,
  //           }),
  //         },
  //       },
  //     ];
  //     setUpdatedThreadMessages(update);
  //     setUpdatedMessages(parentUpdate);
  //   } else {
  //     if (id === _openThreadRef?.current?.id) {
  //       setOpenThread(undefined);
  //     }
  //     setUpdatedMessages(update);
  //   }
  // };

  // const handleDeleteMessage = useCallback(
  //   (message) => {
  //     updateDeletedMessage(message);
  //     curbApi.deleteMessage({ message, chat: activeChatRef.current });
  //   },
  //   [curbApi, activeChat]
  // );

  // const handleEditMode = useCallback((message) => {
  //   console.log("edit mode", message);
  //   const update = [
  //     {
  //       id: message.id,
  //       descriptor: {
  //         updatedFields: { editMode: !message.editMode },
  //       },
  //     },
  //   ];
  //   setUpdatedMessages(update);
  // }, []);

  // const handleEditedMessage = useCallback(
  //   (message) => {
  //     curbApi.editMessage({ message, chat: activeChat });
  //     const update = [
  //       {
  //         id: message.id,
  //         descriptor: {
  //           updatedFields: {
  //             text: message.text,
  //             editMode: false,
  //           },
  //         },
  //       },
  //     ];
  //     setUpdatedMessages(update);
  //   },
  //   [activeChat, curbApi]
  // );

  // const handleEditedThreadMessage = useCallback(
  //   (message) => {
  //     curbApi.editMessage({ message, chat: activeChat });
  //     const update = [
  //       {
  //         id: message.id,
  //         descriptor: {
  //           updatedFields: {
  //             text: message.text,
  //             editMode: false,
  //           },
  //         },
  //       },
  //     ];
  //     setUpdatedThreadMessages(update);
  //   },
  //   [activeChat, curbApi]
  // );

  // const selectThread = useCallback((message) => {
  //   console.log("select thread", message);
  //   setOpenThread(message);
  //   // reset thread updates
  //   setIncomingThreadMessages([]);
  //   setUpdatedThreadMessages([]);
  // }, []);

  const mockSendMessage = async (message: string) => {
    await new ClientApiDataSource().sendMessage({
      group: { name: activeChat.name },
      message,
      timestamp: Math.floor(Date.now() / 1000),
    });
  }

  return (
    <ChatContainerWrapper>
      {activeChat.canJoin ? (
        <JoinChannel
          channelMeta={channelMeta}
          activeChat={activeChat}
          setIsOpenSearchChannel={setIsOpenSearchChannel}
          onJoinedChat={onJoinedChat}
        />
      ) : (
        <>
          <ChatDisplaySplit
            readMessage={() => {}}
            handleReaction={() => {}}
            openThread={openThread}
            setOpenThread={() => {}}
            activeChat={activeChat}
            updatedMessages={updatedMessages}
            resetImage={() => {}}
            sendMessage={(message: string) => mockSendMessage(message)}
            getIconFromCache={getIconFromCache}
            isThread={!!openThread}
            isReadOnly={activeChat.readOnly ?? false}
            toggleEmojiSelector={() => {}}
            channelMeta={channelMeta}
            channelUserList={channelUserList}
            openMobileReactions={openMobileReactions}
            setOpenMobileReactions={() => {}}
            onMessageDeletion={() => {}}
            onEditModeRequested={() => {}}
            onEditModeCancelled={() => {}}
            onMessageUpdated={() => {}}
            loadInitialChatMessages={loadInitialChatMessages}
            incomingMessages={incomingMessages}
          />
          {openThread && openThread.id && (
            <ThreadWrapper>
              <ChatDisplaySplit
                readMessage={(message: MessageWithReactions) => console.log(message)}
                handleReaction={handleReaction}
                openThread={openThread}
                setOpenThread={(message: MessageWithReactions | null) => setOpenThread(message || undefined)}
                activeChat={activeChat}
                updatedMessages={updatedThreadMessages}
                resetImage={() => {}}
                sendMessage={(message: string) => console.log(message)}
                getIconFromCache={getIconFromCache}
                isThread={true}
                isReadOnly={activeChat.readOnly ?? false}
                toggleEmojiSelector={() => {}}
                channelMeta={channelMeta}
                channelUserList={channelUserList}
                openMobileReactions={openMobileReactions}
                setOpenMobileReactions={setOpenMobileReactions}
                onMessageDeletion={(message: MessageWithReactions) => console.log(message)}
                onEditModeRequested={(message: MessageWithReactions) => console.log(message)}
                onEditModeCancelled={(message: MessageWithReactions) => console.log(message)}
                onMessageUpdated={(message: MessageWithReactions) => console.log(message)}
                loadInitialChatMessages={loadInitialChatMessages}
                incomingMessages={incomingMessages}
              />
            </ThreadWrapper>
          )}
        </>
      )}
      {isEmojiSelectorVisible && (
        <EmojiSelectorPopup
          onEmojiSelected={(emoji: string) => {
            handleReaction(messageWithEmojiSelector!, emoji);
            setIsEmojiSelectorVisible(false);
          }}
          onClose={() => setIsEmojiSelectorVisible(false)}
          key="chat-emojis-component"
        />
      )}
    </ChatContainerWrapper>
  );
}
