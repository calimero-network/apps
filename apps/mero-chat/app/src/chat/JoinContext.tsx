import { useState } from "react";
import type { ActiveChat } from "../types/Common";
import { MessageJoinWrapper } from "./JoinChannel";
import Loader from "../components/loader/Loader";
import { styled } from "styled-components";
import { getDMSetupState } from "../utils/dmSetupState";
import { DMSetupState } from "../types/Common";
import type { DMChatInfo } from "../api/clientApi";
import { getStoredSession, updateSessionChat } from "../utils/session";
import { apiClient } from "@calimero-network/calimero-client";

const TextWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;

  .chat-name {
    font-size: 14px;
    color: gray;
  }
`;

interface JoinContextProps {
  activeChat: ActiveChat;
  invitationPayload: string;
  onDMSelected: (dm?: DMChatInfo, sc?: ActiveChat) => void;
}

export default function JoinContext({
  activeChat,
  invitationPayload,
  onDMSelected,
}: JoinContextProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const dmSetupState = getDMSetupState(activeChat);

  // Only show this component when ready to join
  if (dmSetupState !== DMSetupState.INVITEE_CONTEXT_ACCEPT_POPUP) {
    return null;
  }

  const joinContext = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    if (!invitationPayload) {
      setError("No invitation payload found");
      return;
    }
    try {
      const response = await apiClient
        .node()
        .joinContext(invitationPayload.trim());

      if (response.data) {
        const verifyContextResponse = await apiClient
          .node()
          .getContext(activeChat.contextId ?? "");
        if (verifyContextResponse.data) {
          setSuccess("Context joined successfully");
          const savedSession = getStoredSession();
          if (savedSession) {
            savedSession.canJoin = false;
            savedSession.isSynced =
              verifyContextResponse.data.rootHash !==
              "11111111111111111111111111111111";
            updateSessionChat(savedSession);
            onDMSelected(undefined, savedSession);
          }
        } else {
          setError(
            verifyContextResponse.error?.message || "Failed to verify context",
          );
        }
      } else {
        setError(response.error?.message || "Failed to join context");
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "An unexpected error occurred",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <MessageJoinWrapper>
      <div className="messageBox">
        <div className="messageBoxHeader">
          <TextWrapper>
            <div className="title">Join Private DM Context</div>
            <span className="chat-name">User ID: {activeChat.name}</span>
          </TextWrapper>
        </div>
        {error && <div className="error">{error}</div>}
        {success && <div className="success">{success}</div>}
        {!success && (
          <div className="wrapper">
            <button
              className="join-button"
              onClick={joinContext}
              disabled={loading || !invitationPayload}
            >
              {loading ? <Loader size={16} /> : "Join Context"}
            </button>
          </div>
        )}
      </div>
    </MessageJoinWrapper>
  );
}
