import { useState } from "react";
import type { ActiveChat } from "../types/Common";
import { MessageJoinWrapper } from "./JoinChannel";
import Loader from "../components/loader/Loader";
import { styled } from "styled-components";
import { getDMSetupState } from "../utils/dmSetupState";
import { DMSetupState } from "../types/Common";
import type { DMChatInfo } from "../api/clientApi";
import { getStoredSession, updateSessionChat } from "../utils/session";
import {
  apiClient,
  type ResponseData,
} from "@calimero-network/calimero-client";
import type {
  JoinContextResponse,
  NodeIdentity,
  SignedOpenInvitation,
} from "@calimero-network/calimero-client/lib/api/nodeApi";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";

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
      let executorPublicKey = "";

      const createIdentityResponse: ResponseData<NodeIdentity> = await apiClient
        .node()
        .createNewIdentity();

      if (createIdentityResponse.error) {
        setError(
          createIdentityResponse.error.message ||
            "Failed to create identity for this invitation"
        );
      } else if (createIdentityResponse.data) {
        executorPublicKey = createIdentityResponse.data.publicKey;
      }

      if (!executorPublicKey) {
        setError("Please create an identity first");
        return;
      }
      const response: ResponseData<JoinContextResponse> = await apiClient
        .node()
        .joinContextByOpenInvitation(
          JSON.parse(invitationPayload.trim()) as SignedOpenInvitation,
          executorPublicKey
        );

      if (response.data) {
        const verifyContextResponse = await apiClient
          .node()
          .getContext(activeChat.contextId ?? "");
        if (verifyContextResponse.data) {

          const clientResponse = await new ClientApiDataSource().updateNewIdentity({
            other_user: activeChat.creator ?? "",
            new_identity: executorPublicKey,
          });

          if (clientResponse.error) {
            setError(clientResponse.error?.message || "Failed to update new identity");
          }

          setSuccess("Context joined successfully");
          const savedSession = getStoredSession();
          
          if (savedSession) {
            savedSession.canJoin = false;
            savedSession.isSynced =
              verifyContextResponse.data.rootHash !==
              "11111111111111111111111111111111";
            // Preserve identity information during context join
            if (!savedSession.ownIdentity && executorPublicKey) {
              savedSession.ownIdentity = executorPublicKey;
              savedSession.account = executorPublicKey;
            }
            if (!savedSession.ownUsername && activeChat.username) {
              savedSession.ownUsername = activeChat.username;
            }
            updateSessionChat(savedSession);
            // Trigger DM list refresh to update UI state
            onDMSelected(undefined, savedSession);
          }
        } else {
          setError(
            verifyContextResponse.error?.message || "Failed to verify context"
          );
        }
      } else {
        setError(response.error?.message || "Failed to join context");
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "An unexpected error occurred"
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
          </TextWrapper>
        </div>
        {error && <div className="error">{error}</div>}
        {success && <div className="success">{success}</div>}
        {!success && (
          <div className="wrapper">
            <button
              className="join-button"
              style={{
                backgroundColor: "#A5FF11",
                border: "1px solid #16a34a",
                color: "#0E0E10",
              }}
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
