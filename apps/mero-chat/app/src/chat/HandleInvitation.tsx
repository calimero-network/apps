import { styled } from "styled-components";
import type { ActiveChat } from "../types/Common";
import { useState } from "react";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import { getStoredSession, updateSessionChat } from "../utils/session";
import { getDMSetupState } from "../utils/dmSetupState";
import { DMSetupState } from "../types/Common";
import type { DMChatInfo } from "../api/clientApi";
import { apiClient } from "@calimero-network/calimero-client";

export const Wrapper = styled.div`
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  color: white;
  font-family: Helvetica Neue;
  text-align: center;
  padding: 2rem;
`;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 500;
  line-height: 120%;
  margin-bottom: 1rem;
  color: white;
`;

const Message = styled.p`
  font-size: 16px;
  font-weight: 400;
  line-height: 150%;
  color: #777583;
  margin-bottom: 0.5rem;
`;

const Button = styled.button`
  background-color: #5765f2;
  color: white;
  border: none;
  border-radius: 4px;
  font-family: Helvetica Neue;
  font-size: 16px;
  font-weight: 400;
  line-height: 150%;
  padding: 12px 24px;
  cursor: pointer;
  margin-top: 1rem;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: #717cf0;
  }

  &:active {
    background-color: #4a5bd1;
  }
`;

interface HandleInvitationProps {
  activeChat: ActiveChat;
  onDMSelected: (dm?: DMChatInfo, sc?: ActiveChat) => void;
}

export default function HandleInvitation({
  activeChat,
  onDMSelected
}: HandleInvitationProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const dmSetupState = getDMSetupState(activeChat);

  // Only show this component when creator needs to invite
  if (dmSetupState !== DMSetupState.CREATOR_CONTEXT_INVITATION_POPUP) {
    return null;
  }

  const handleInvite = async () => {
    setLoading(true);
    try {
      const response = await apiClient.node().contextInvite(
        activeChat.contextId ?? "",
        activeChat.otherIdentityNew ?? "",
        activeChat.account ?? "",
      );
      if (response.data) {
        const invitationPayload = response.data;
        const clientResponse =
          await new ClientApiDataSource().updateInvitationPayload({
            other_user: activeChat.name ?? "",
            invitation_payload: invitationPayload,
          });
        if (clientResponse.data) {
          setSuccess("Invitation sent successfully!");
          const savedSession = getStoredSession();
          if (savedSession) {
            savedSession.invitationPayload = invitationPayload;
            updateSessionChat(savedSession);
            onDMSelected(undefined, savedSession);
          }
          setTimeout(() => {
            window.location.reload();
          }, 3000);
        } else {
          setError(
            clientResponse.error?.message ||
              "Failed to update invitation payload"
          );
        }
      } else {
        setError(response.error?.message || "Failed to invite user");
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
    <Wrapper>
      <Title>Invite User</Title>
      {error && <Message className="error">{error}</Message>}
      {success && <Message className="success">{success}</Message>}
      {!error && !success && (
        <Message>You need to invite the user to context to continue.</Message>
      )}
      {!success && (
        <Button onClick={handleInvite} disabled={loading}>
          {loading ? "Inviting..." : "Invite user to channel"}
        </Button>
      )}
    </Wrapper>
  );
}
