import React, { useState, useEffect } from "react";
import { styled } from "styled-components";
import { CalimeroConnectButton, setAppEndpointKey, setContextId, setExecutorPublicKey, getAppEndpointKey, apiClient } from "@calimero-network/calimero-client";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import { extractErrorMessage } from "../../utils/errorParser";
import { defaultActiveChat } from "../../mock/mock";
import { updateSessionChat } from "../../utils/session";
import { CONTEXT_ID } from "../../constants/config";
import type { ResponseData } from "@calimero-network/calimero-client";
import type { FetchContextIdentitiesResponse } from "@calimero-network/calimero-client/lib/api/nodeApi";

const TabContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  align-items: center;
  width: 100%;
`;

const ConnectWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  text-align: center;
`;

const Subtitle = styled.h2`
  text-align: center;
  color: #b8b8d1;
  margin-bottom: 1.5rem;
  font-size: 1rem;
  font-weight: 600;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  max-width: 400px;
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const Label = styled.label`
  font-size: 0.9rem;
  font-weight: 500;
  color: #b8b8d1;
`;

const ConfigBox = styled.div`
  background: rgba(60, 60, 75, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 0.75rem;
  font-size: 0.85rem;
  color: #e0e0e0;
  font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
  word-break: break-all;
  min-height: 2rem;
  display: flex;
  align-items: center;
`;

const Button = styled.button`
  background: #111;
  color: white;
  border: none;
  padding: 0.75rem;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  margin-top: 1rem;
  border: 1px solid rgba(255, 255, 255, 0.1);

  &:hover {
    transform: translateY(-1px);
    box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }
`;

const Message = styled.div<{ type?: "success" | "error" }>`
  font-size: 0.9rem;
  text-align: center;
  color: ${({ type }) =>
    type === "success"
      ? "#27ae60"
      : type === "error"
      ? "#e74c3c"
      : "#b8b8d1"};
`;

interface ChatTabProps {
  isAuthenticated: boolean;
  isConfigSet: boolean;
}

export default function ChatTab({ isAuthenticated, isConfigSet }: ChatTabProps) {
  const [formData, setFormData] = useState({
    nodeUrl: "",
    contextId: "",
    identityId: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDisabled, setIsDisabled] = useState(false);

  useEffect(() => {
    const setupConfigs = async () => {
      if (isAuthenticated && !isConfigSet) {
        setIsDisabled(false);
        const nodeUrl = getAppEndpointKey() || "";
        const contextId = CONTEXT_ID;

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
      const response: ResponseData<string> =
        await new ClientApiDataSource().joinChat({
          isDM: false,
        });
      if (response.error) {
        const errorMessage = extractErrorMessage(response.error);
        if (errorMessage.includes("Already a member")) {
          setSuccess("Already connected to chat!");
          updateSessionChat(defaultActiveChat);
        } else {
          setError(errorMessage);
          return;
        }
      } else {
        setSuccess("Successfully joined chat!");
        updateSessionChat(defaultActiveChat);
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
          <ConfigBox>{formData.nodeUrl || "Loading..."}</ConfigBox>
        </InputGroup>

        <InputGroup>
          <Label>Context ID</Label>
          <ConfigBox>{formData.contextId || "Loading..."}</ConfigBox>
        </InputGroup>

        <InputGroup>
          <Label>Identity ID</Label>
          <ConfigBox>{formData.identityId || "Loading..."}</ConfigBox>
        </InputGroup>

        <Button type="submit" disabled={isLoading || isDisabled}>
          {isLoading ? "Setting up..." : "Connect"}
        </Button>

        {error && <Message type="error">{error}</Message>}
        {success && <Message type="success">{success}</Message>}
      </Form>
    </TabContent>
  );
}
