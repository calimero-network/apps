import { useEffect } from "react";
import type { DMChatInfo } from "../api/clientApi";
import type { ActiveChat } from "../types/Common";
import { Message, Title, Wrapper } from "./HandleDMSetup";
import { getStoredSession, updateSessionChat } from "../utils/session";
import Loader from "../components/loader/Loader";
import { apiClient } from "@calimero-network/calimero-client";
import { log } from "../utils/logger";

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
        const verifyResponse = await apiClient
          .node()
          .getContext(activeChat.contextId ?? "");

        if (verifyResponse.data) {
          const data = {
            joined: verifyResponse.data.rootHash ? true : false,
            isSynced:
              verifyResponse.data.rootHash !==
              "11111111111111111111111111111111",
          };
          const savedSession = getStoredSession();
          if (savedSession) {
            savedSession.isSynced = data.isSynced;
            if (data.isSynced) {
              savedSession.isFinal = true;
            }
            updateSessionChat(savedSession);
            onDMSelected(undefined, savedSession);
          }
        }
      } catch (error) {
        log.error("SyncWaiting", "Error verifying context", error);
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
