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

export const Title = styled.h1`
  font-size: 20px;
  font-weight: 500;
  line-height: 120%;
  margin-bottom: 1rem;
  color: white;
`;

export const Message = styled.p`
  font-size: 14px;
  font-weight: 400;
  line-height: 150%;
  color: #777583;
  margin-bottom: 0.5rem;

  &.padding,
  &.success {
    width: 50%;
  }
`;

const Button = styled.button`
  background-color: #5765f2;
  color: white;
  border: none;
  border-radius: 4px;
  font-family: Helvetica Neue;
  font-size: 14px;
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

interface HandleDMSetupProps {
  activeChat: ActiveChat;
  onDMSelected: (dm?: DMChatInfo, sc?: ActiveChat) => void;
}

export default function HandleDMSetup({
  activeChat,
  onDMSelected,
}: HandleDMSetupProps) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const handleCreateIdentity = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await apiClient.node().createNewIdentity();
      if (response.data) {
        const updateIdentityResponse =
          await new ClientApiDataSource().updateNewIdentity({
            other_user: activeChat.creator ?? "",
            new_identity: response.data.publicKey,
          });

        if (updateIdentityResponse.data) {
          setSuccess(
            "New identity created successfully and saved in context. You will soon receive an invitation to join the context.",
          );
          // Update session with new identity information
          const savedSession = getStoredSession();
          if (savedSession) {
            // Update with new identity information
            savedSession.account = response.data.publicKey;
            savedSession.ownIdentity = response.data.publicKey;
            savedSession.ownUsername = activeChat.ownUsername || activeChat.username || "";
            updateSessionChat(savedSession);
            onDMSelected(undefined, savedSession);
          }
        } else {
          setError(
            updateIdentityResponse.error?.message ||
              "Failed to update identity",
          );
        }
      } else {
        setError(response.error?.message || "Failed to create identity");
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "An unexpected error occurred",
      );
    } finally {
      setLoading(false);
    }
  };

  const dmSetupState = getDMSetupState(activeChat);

  // If we're the creator waiting for invitee setup
  if (
    dmSetupState === DMSetupState.CREATOR_WAITING_FOR_INVITEE_TO_CREATE_IDENTITY
  ) {
    return (
      <Wrapper>
        <Title>Setup</Title>
        <Message>
          You are waiting for the invitee to set up their new identity.
        </Message>
        <Message className="padding">
          Once the invitee has set up their new identity, you will be able to
          invite them to the context.
        </Message>
      </Wrapper>
    );
  }

  // If we're the invitee and need to create identity
  if (
    dmSetupState === DMSetupState.INVITEE_CONTEXT_CREATE_IDENTITY &&
    !activeChat.account
  ) {
    return (
      <Wrapper>
        <Title>Create new identity</Title>
        {success ? (
          <Message className="success">{success}</Message>
        ) : (
          <Button onClick={handleCreateIdentity} disabled={loading}>
            {loading ? "Creating..." : "Create new identity"}
          </Button>
        )}
        {error && <Message>{error}</Message>}
      </Wrapper>
    );
  }

  return <></>;
}
