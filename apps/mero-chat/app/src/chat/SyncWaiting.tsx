import { useEffect } from "react";
import type { DMChatInfo } from "../api/clientApi";
import { ContextApiDataSource } from "../api/dataSource/nodeApiDataSource";
import type { ActiveChat } from "../types/Common";
import { Message, Title, Wrapper } from "./HandleDMSetup";
import { getStoredSession, updateSessionChat } from "../utils/session";
import Loader from "../components/loader/Loader";

interface SyncWaitingProps {
  activeChat: ActiveChat;
  onDMSelected: (dm?: DMChatInfo, sc?: ActiveChat) => void;
}

export default function SyncWaiting({
  activeChat,
  onDMSelected,
}: SyncWaitingProps) {
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const verifyResponse = await new ContextApiDataSource().verifyContext({
          contextId: activeChat.contextId ?? "",
        });

        if (verifyResponse.data) {
          const savedSession = getStoredSession();
          if (savedSession) {
            savedSession.isSynced = verifyResponse.data.isSynced;
            updateSessionChat(savedSession);
            onDMSelected(undefined, savedSession);
          }
        }
      } catch (error) {
        console.error("Error verifying context:", error);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [activeChat.contextId, onDMSelected]);

  return (
    <Wrapper>
      <Title>Syncing data</Title>
      <Message>Please wait while the context state is syncing</Message>
      <Loader />
    </Wrapper>
  );
}
