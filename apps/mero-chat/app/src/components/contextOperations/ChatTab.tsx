import React, { useState, useEffect } from "react";
import { styled } from "styled-components";
import {
  CalimeroConnectButton,
  setAppEndpointKey,
  setContextId,
  setExecutorPublicKey,
  getAppEndpointKey,
  apiClient,
  //getContextId,
  //getExecutorPublicKey,
} from "@calimero-network/calimero-client";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
// import { ContextApiDataSource } from "../../api/dataSource/nodeApiDataSource";
import { extractErrorMessage } from "../../utils/errorParser";
import { defaultActiveChat } from "../../mock/mock";
import { getStoredSession, updateSessionChat } from "../../utils/session";
import type { ResponseData } from "@calimero-network/calimero-client";
import type { FetchContextIdentitiesResponse } from "@calimero-network/calimero-client/lib/api/nodeApi";
import type { ActiveChat } from "../../types/Common";
//import type { ContextInfo } from "../../api/nodeApi";
import { CONTEXT_ID } from "../../constants/config";
import { Button, Input } from "@calimero-network/mero-ui";

const TabContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: center;
  width: 100%;
`;

const ConnectWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  text-align: center;
`;

const Subtitle = styled.h2`
  text-align: center;
  color: #b8b8d1;
  margin-bottom: 0.6rem;
  font-size: 0.7rem;
  font-weight: 600;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  width: 100%;
  max-width: 400px;
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
`;

const Label = styled.label`
  font-size: 0.7rem;
  font-weight: 500;
  color: #b8b8d1;
`;

const Note = styled.p`
  font-size: 0.6rem;
  color: #b8b8d1;
  margin-top: 0.2rem;
`;

const _Select = styled.select`
  padding: 0.6rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #fff;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.2);
  }

  &:focus {
    outline: none;
    border-color: #7c3aed;
    background: rgba(255, 255, 255, 0.08);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  option {
    background: #1a1a1f;
    color: #fff;
  }
`;

const Message = styled.div<{ type?: "success" | "error" | "info" }>`
  font-size: 0.7rem;
  text-align: center;
  color: ${({ type }) =>
    type === "success"
      ? "#27ae60"
      : type === "error"
        ? "#e74c3c"
        : type === "info"
          ? "#3b82f6"
          : "#b8b8d1"};
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
  // const [availableContexts, setAvailableContexts] = useState<ContextInfo[]>([]);
  // const [fetchingContexts, setFetchingContexts] = useState(false);
  const [fetchingIdentity, setFetchingIdentity] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDisabled, setIsDisabled] = useState(false);
  const [username, setUsername] = useState("");

  // Fetch available contexts when authenticated
  useEffect(() => {
    const fetchAvailableContexts = async () => {
      if (isAuthenticated && !isConfigSet) {
        //setFetchingContexts(true);
        const nodeUrl = getAppEndpointKey() || "";
        const contextId = CONTEXT_ID || "";
        setFormData((prev) => ({ ...prev, nodeUrl, contextId }));
        await fetchIdentityForContext(contextId);

        // try {
        //   const nodeApi = new ContextApiDataSource();
        //   const response = await nodeApi.listContexts();
        //   console.log("response", response);
        //   if (response.data && response.data.length > 0) {
        //     //setAvailableContexts(response.data);
        //     // Auto-select first context if only one available
        //     if (response.data.length === 1) {
        //       const contextId = response.data[0].contextId;
        //       setFormData((prev) => ({ ...prev, contextId }));
        //       await fetchIdentityForContext(contextId);
        //     }
        //   } else {
        //     setError(
        //       "No contexts found on this node. Please join or create a context first.",
        //     );
        //     setIsDisabled(true);
        //   }
        // } catch (err) {
        //   console.error("Error fetching contexts:", err);
        //   setError("Failed to fetch available contexts from node");
        //   setIsDisabled(true);
        // } finally {
        //   //setFetchingContexts(false);
        // }
      }
    };

    if (isAuthenticated && !isConfigSet) {
      fetchAvailableContexts();
    }
  }, [isAuthenticated, isConfigSet]);

  const [fetchUsername, setFetchingUsername] = useState(false);

  // Fetch identity for selected context
  const fetchIdentityForContext = async (contextId: string) => {
    if (!contextId) return;

    setFetchingIdentity(true);
    setError("");
    setIsDisabled(false);

    try {
      const contextIdentityResponse: ResponseData<FetchContextIdentitiesResponse> =
        await apiClient.node().fetchContextIdentities(contextId);
      setContextId(contextId);

      if (
        contextIdentityResponse.data &&
        contextIdentityResponse.data.identities.length > 0
      ) {
        const contextIdentity: string =
          contextIdentityResponse.data.identities[0];
        setFetchingUsername(true);
        const usernameResponse = await new ClientApiDataSource().getUsername({
          userId: contextIdentity,
          executorPublicKey: contextIdentity,
          contextId: contextId,
        });
        setFormData((prev) => ({
          ...prev,
          contextId,
          identityId: contextIdentity,
        }));
        if (usernameResponse.data) {
          setExecutorPublicKey(contextIdentity);
          setUsername(usernameResponse.data);
          setContextId(contextId);
          localStorage.setItem("chat-username", username);

          const storedSession: ActiveChat | null = getStoredSession();
          const chatToUse = storedSession || defaultActiveChat;

          updateSessionChat(chatToUse);
          setSuccess("Already joined the chat!");
          setTimeout(() => {
            window.location.href = "/";
          }, 1000);
        }
        setFetchingUsername(false);
      } else if (
        contextIdentityResponse.error?.message === "Context not found"
      ) {
        setIsDisabled(true);
        setError(
          "You are not a member of this context. Please join the context first."
        );
      } else {
        setError("Failed to fetch identity for this context");
      }
    } catch (_error) {
      setError("Failed to fetch context identity");
    } finally {
      setFetchingIdentity(false);
    }
  };

  // Handle context selection change
  const _handleContextChange = async (
    e: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const contextId = e.target.value;
    if (contextId) {
      await fetchIdentityForContext(contextId);
    }
  };

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

        {/* <InputGroup>
          <Label>Select Context</Label>
          <Select
            id="contextSelect"
            value={formData.contextId}
            onChange={handleContextChange}
            disabled={fetchingContexts || availableContexts.length === 0}
          >
            <option value="">
              {fetchingContexts
                ? "Loading contexts..."
                : availableContexts.length === 0
                  ? "No contexts available"
                  : "Select a context..."}
            </option>
            {availableContexts.map((context) => (
              <option key={context.contextId} value={context.contextId}>
                {context.contextId}
              </option>
            ))}
          </Select>
          <Note>
            {availableContexts.length > 0
              ? `${availableContexts.length} context${availableContexts.length !== 1 ? "s" : ""} available`
              : "Connect to a node to see available contexts"}
          </Note>
        </InputGroup> */}

        {/* {fetchingIdentity && (
          <Message type="info">
            Fetching identity for selected context...
          </Message>
        )} */}

        <InputGroup>
          <Label>Identity ID</Label>
          <Input
            id="identityId"
            type="text"
            value={fetchUsername ? "Loading..." : formData.identityId}
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
            disabled={isLoading || !formData.identityId}
          />
        </InputGroup>

        <Button
          type="submit"
          disabled={
            isLoading ||
            isDisabled ||
            !username.trim() ||
            !formData.contextId ||
            !formData.identityId ||
            fetchingIdentity
          }
        >
          {isLoading ? "Setting up..." : "Connect"}
        </Button>

        {error && <Message type="error">{error}</Message>}
        {success && <Message type="success">{success}</Message>}
      </Form>
    </TabContent>
  );
}
