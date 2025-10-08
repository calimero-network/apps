import React, { useState, useEffect } from "react";
import { styled } from "styled-components";
import {
  CalimeroConnectButton,
  setAppEndpointKey,
  setContextId,
  setExecutorPublicKey,
  getAppEndpointKey,
  apiClient,
} from "@calimero-network/calimero-client";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import { extractErrorMessage } from "../../utils/errorParser";
import { defaultActiveChat } from "../../mock/mock";
import { getStoredSession, updateSessionChat } from "../../utils/session";
import { CONTEXT_ID } from "../../constants/config";
import type { ResponseData } from "@calimero-network/calimero-client";
import type { FetchContextIdentitiesResponse } from "@calimero-network/calimero-client/lib/api/nodeApi";
import type { ActiveChat } from "../../types/Common";
import { Button, Input } from "@calimero-network/mero-ui";

const TabContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: center;
  width: 100%;
`;

const ConnectWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  text-align: center;
`;

const Subtitle = styled.h2`
  text-align: center;
  color: #b8b8d1;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  font-weight: 600;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
  max-width: 400px;
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
`;

const Label = styled.label`
  font-size: 0.8rem;
  font-weight: 500;
  color: #b8b8d1;
`;

const Note = styled.p`
  font-size: 0.7rem;
  color: #b8b8d1;
  margin-top: 0.2rem;
`;

const Message = styled.div<{ type?: "success" | "error" }>`
  font-size: 0.8rem;
  text-align: center;
  color: ${({ type }) =>
    type === "success" ? "#27ae60" : type === "error" ? "#e74c3c" : "#b8b8d1"};
`;

interface ChatTabProps {
  isAuthenticated: boolean;
  isConfigSet: boolean;
}

export default function ChatTab({
  isAuthenticated,
  isConfigSet,
}: ChatTabProps) {
  const [formData, setFormData] = useState({
    nodeUrl: "",
    contextId: "",
    identityId: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDisabled, setIsDisabled] = useState(false);
  const [username, setUsername] = useState("");

  useEffect(() => {
    const setupConfigs = async () => {
      if (isAuthenticated && !isConfigSet) {
        setIsDisabled(false);
        const nodeUrl = getAppEndpointKey() || "";
        const contextId = CONTEXT_ID;
        setUsername(localStorage.getItem("chat-username") || "");

        try {
          const contextIdentityResponse: ResponseData<FetchContextIdentitiesResponse> =
            await apiClient.node().fetchContextIdentities(contextId);
          if (contextIdentityResponse.data) {
            const contextIdentity: string =
              contextIdentityResponse.data.identities[0];
            setFormData({
              nodeUrl,
              contextId,
              identityId: contextIdentity,
            });
          } else if (
            contextIdentityResponse.error?.message === "Context not found"
          ) {
            setIsDisabled(true);
            setError("You are not a member of this context.");
          } else {
            setError("Failed to fetch context identity");
          }
        } catch (_error) {
          setError("Failed to fetch context identity");
        }
      }
    };

    if (isAuthenticated && !isConfigSet) {
      setupConfigs();
    }
  }, [isAuthenticated, isConfigSet]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setSuccess("");

    try {
      setAppEndpointKey(formData.nodeUrl.trim());
      setContextId(formData.contextId.trim());
      setExecutorPublicKey(formData.identityId.trim());
      localStorage.setItem("chat-username", username);
      const response: ResponseData<string> =
        await new ClientApiDataSource().joinChat({
          isDM: false,
          username: username,
        });
      if (response.error) {
        const errorMessage = extractErrorMessage(response.error);
        if (errorMessage.includes("Already a member")) {
          setSuccess("Already connected to chat!");
          const storedSession: ActiveChat | null = getStoredSession();
          const chatToUse = storedSession || defaultActiveChat;
          updateSessionChat(chatToUse);
        } else {
          setError(errorMessage);
          return;
        }
      } else {
        setSuccess("Successfully joined chat!");
        const storedSession: ActiveChat | null = getStoredSession();
        const chatToUse = storedSession || defaultActiveChat;
        updateSessionChat(chatToUse);
      }

      setTimeout(() => {
        window.location.href = "/";
      }, 1000);
    } catch (_err) {
      setError("Failed to save login information");
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthenticated && !isConfigSet) {
    return (
      <TabContent>
        <ConnectWrapper>
          <Subtitle>Connect your Node to get started</Subtitle>
          <CalimeroConnectButton />
        </ConnectWrapper>
      </TabContent>
    );
  }

  return (
    <TabContent>
      <Form onSubmit={handleSubmit}>
        <InputGroup>
          <Label>Node URL</Label>
          <Input
            id="nodeUrl"
            type="text"
            value={formData.nodeUrl || "Loading..."}
            disabled={true}
          />
        </InputGroup>

        <InputGroup>
          <Label>Context ID</Label>
          <Input
            id="contextId"
            type="text"
            value={formData.contextId || "Loading..."}
            disabled={true}
          />
        </InputGroup>

        <InputGroup>
          <Label>Identity ID</Label>
          <Input
            id="identityId"
            type="text"
            value={formData.identityId || "Loading..."}
            disabled={true}
          />
        </InputGroup>
        <InputGroup>
          <Label>Username or Name</Label>
          <Note>
            *This will be used to identify you in the chat and can only be set
            ONCE.
          </Note>
          <Input
            id="invitationPayload"
            type="text"
            placeholder="John Doe"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={isLoading}
          />
        </InputGroup>

        <Button type="submit" disabled={isLoading || isDisabled || !username.trim()}>
          {isLoading ? "Setting up..." : "Connect"}
        </Button>

        {error && <Message type="error">{error}</Message>}
        {success && <Message type="success">{success}</Message>}
      </Form>
    </TabContent>
  );
}
