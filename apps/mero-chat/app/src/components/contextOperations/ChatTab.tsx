import React, { useState, useEffect, useCallback, useRef } from "react";
import { styled } from "styled-components";
import {
  CalimeroConnectButton,
  setAppEndpointKey,
  setContextId,
  setExecutorPublicKey,
  getAppEndpointKey,
  getContextId,
  getExecutorPublicKey,
  apiClient,
} from "@calimero-network/calimero-client";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import { ContextApiDataSource } from "../../api/dataSource/nodeApiDataSource";
import { extractErrorMessage } from "../../utils/errorParser";
import { defaultActiveChat } from "../../mock/mock";
import { getStoredSession, updateSessionChat } from "../../utils/session";
import type { ResponseData } from "@calimero-network/calimero-client";
import type { FetchContextIdentitiesResponse } from "@calimero-network/calimero-client/lib/api/nodeApi";
import type { ActiveChat } from "../../types/Common";
import type { ContextInfo } from "../../api/nodeApi";
import { Button, Input } from "@calimero-network/mero-ui";
import { StorageHelper } from "../../utils/storage";
import {
  saveInvitationToStorage,
  parseInvitationInput,
} from "../../utils/invitation";

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

const Select = styled.select`
  padding: 0.6rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #fff;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
  width: 100%;

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
  onInvitationSaved?: () => void;
}

export default function ChatTab({
  isAuthenticated,
  isConfigSet,
  onInvitationSaved,
}: ChatTabProps) {
  const [nodeUrl, setNodeUrl] = useState("");
  const [availableContexts, setAvailableContexts] = useState<ContextInfo[]>([]);
  const [selectedContextId, setSelectedContextId] = useState("");
  const [contextIdentities, setContextIdentities] = useState<string[]>([]);
  const [selectedIdentityId, setSelectedIdentityId] = useState("");
  const [username, setUsername] = useState("");
  const [fetchingContexts, setFetchingContexts] = useState(false);
  const [fetchingIdentities, setFetchingIdentities] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDisabled, setIsDisabled] = useState(false);
  const lastCheckedIdentityRef = useRef<string | null>(null);
  const [invitationInput, setInvitationInput] = useState("");
  const [invitationError, setInvitationError] = useState("");
  const [submittingInvitation, setSubmittingInvitation] = useState(false);
  const [completeJoinUsername, setCompleteJoinUsername] = useState("");
  const [completeJoinLoading, setCompleteJoinLoading] = useState(false);
  const [completeJoinError, setCompleteJoinError] = useState("");
  const [completeJoinSuccess, setCompleteJoinSuccess] = useState("");

  // Fetch contexts from node API when authenticated (no hardcoded contextId)
  const fetchContexts = useCallback(async () => {
    const url = getAppEndpointKey();
    if (!url) return;
    setFetchingContexts(true);
    setError("");
    try {
      const nodeApi = new ContextApiDataSource();
      const response = await nodeApi.listContexts();
      if (response.data && response.data.length > 0) {
        setAvailableContexts(response.data);
        if (response.data.length === 1) {
          setSelectedContextId(response.data[0].contextId);
        }
      } else if (response.error) {
        setError(response.error.message || "Failed to fetch contexts");
        setAvailableContexts([]);
      } else {
        setError("No contexts found on this node. Join or create a context first.");
        setAvailableContexts([]);
        setIsDisabled(true);
      }
    } catch (_err) {
      setError("Failed to fetch contexts from node");
      setAvailableContexts([]);
    } finally {
      setFetchingContexts(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && !isConfigSet) {
      setNodeUrl(getAppEndpointKey() || "");
      fetchContexts();
    }
  }, [isAuthenticated, isConfigSet, fetchContexts]);

  // When context is selected, fetch identities for that context
  useEffect(() => {
    if (!selectedContextId) {
      setContextIdentities([]);
      setSelectedIdentityId("");
      return;
    }
    let cancelled = false;
    setFetchingIdentities(true);
    setError("");
    apiClient
      .node()
      .fetchContextIdentities(selectedContextId)
      .then((res: ResponseData<FetchContextIdentitiesResponse>) => {
        if (cancelled) return;
        if (res.error) {
          setError(res.error.message || "Failed to fetch identities");
          if (res.error.message === "Context not found") {
            setIsDisabled(true);
            setError("You are not a member of this context. Join the context first.");
          }
          setContextIdentities([]);
          return;
        }
        if (res.data?.identities && res.data.identities.length > 0) {
          setContextIdentities(res.data.identities);
          if (res.data.identities.length === 1) {
            setSelectedIdentityId(res.data.identities[0]);
          }
        } else {
          setContextIdentities([]);
          setError("No identities found for this context.");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to fetch identities");
        setContextIdentities([]);
      })
      .finally(() => {
        if (!cancelled) setFetchingIdentities(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedContextId]);

  // When context + identity are selected, check username: if exists -> login & redirect; else show username step
  const onIdentitySelected = useCallback(
    async (identityId: string) => {
      if (!selectedContextId || !identityId) return;
      setContextId(selectedContextId);
      setExecutorPublicKey(identityId);
      setCheckingUsername(true);
      setError("");
      try {
        const usernameResponse = await new ClientApiDataSource().getUsername({
          userId: identityId,
          executorPublicKey: identityId,
          contextId: selectedContextId,
        });
        if (usernameResponse.data) {
          setUsername(usernameResponse.data);
          StorageHelper.setItem("chat-username", usernameResponse.data);
          const storedSession: ActiveChat | null = getStoredSession();
          const chatToUse = storedSession || defaultActiveChat;
          updateSessionChat(chatToUse);
          setSuccess("Already joined the chat!");
          setTimeout(() => {
            window.location.href = "/" + (window.location.search || "");
          }, 1000);
        }
      } catch {
        setError("Failed to check username");
      } finally {
        setCheckingUsername(false);
      }
    },
    [selectedContextId],
  );

  useEffect(() => {
    const key = `${selectedContextId}:${selectedIdentityId}`;
    if (
      !selectedIdentityId ||
      !selectedContextId ||
      lastCheckedIdentityRef.current === key
    ) {
      return;
    }
    lastCheckedIdentityRef.current = key;
    onIdentitySelected(selectedIdentityId);
  }, [selectedIdentityId, selectedContextId, onIdentitySelected]);

  const handleContextChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedContextId(id);
    setSelectedIdentityId("");
    setContextIdentities([]);
    setError("");
  };

  const handleIdentityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedIdentityId(e.target.value);
    setError("");
  };

  const handleUseInvitation = (e: React.FormEvent) => {
    e.preventDefault();
    setInvitationError("");
    setSubmittingInvitation(true);
    const payload = parseInvitationInput(invitationInput);
    if (!payload) {
      setInvitationError("Invalid invitation. Paste a full invite URL or the encoded invitation.");
      setSubmittingInvitation(false);
      return;
    }
    saveInvitationToStorage(payload);
    setInvitationInput("");
    setSubmittingInvitation(false);
    onInvitationSaved?.();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContextId || !selectedIdentityId || !username.trim()) return;
    setIsLoading(true);
    setError("");
    setSuccess("");

    try {
      const url = getAppEndpointKey() || nodeUrl;
      if (url) setAppEndpointKey(url.trim());
      setContextId(selectedContextId);
      setExecutorPublicKey(selectedIdentityId);
      StorageHelper.setItem("chat-username", username.trim());
      const response: ResponseData<string> =
        await new ClientApiDataSource().joinChat({
          isDM: false,
          username: username.trim(),
          contextId: selectedContextId,
          executorPublicKey: selectedIdentityId,
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
        window.location.href = "/" + (window.location.search || "");
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

  // Config set but no chat username yet — show join form. Only hide when they have chat-username (nothing else).
  const hasChatUsername = !!StorageHelper.getItem("chat-username");
  if (isConfigSet && !hasChatUsername) {
    return (
      <TabContent>
        <Form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!completeJoinUsername.trim()) return;
            const ctxId = getContextId();
            const execKey = getExecutorPublicKey();
            if (!ctxId || !execKey) {
              setCompleteJoinError("Context or identity missing. Please log out and select context and identity again.");
              return;
            }
            setCompleteJoinLoading(true);
            setCompleteJoinError("");
            setCompleteJoinSuccess("");
            try {
              StorageHelper.setItem("chat-username", completeJoinUsername.trim());
              const response = await new ClientApiDataSource().joinChat({
                isDM: false,
                username: completeJoinUsername.trim(),
                contextId: ctxId,
                executorPublicKey: execKey,
              });
              if (response.error) {
                const msg = extractErrorMessage(response.error);
                if (msg.includes("Already a member")) {
                  setCompleteJoinSuccess("Already connected! Taking you to chat...");
                  const storedSession = getStoredSession();
                  const chatToUse = storedSession || defaultActiveChat;
                  updateSessionChat(chatToUse);
                } else {
                  setCompleteJoinError(msg);
                  setCompleteJoinLoading(false);
                  return;
                }
              } else {
                setCompleteJoinSuccess("Joined! Taking you to chat...");
                const storedSession = getStoredSession();
                const chatToUse = storedSession || defaultActiveChat;
                updateSessionChat(chatToUse);
              }
              setTimeout(() => {
                window.location.href = "/" + (window.location.search || "");
              }, 1000);
            } catch {
              setCompleteJoinError("Failed to join chat");
            } finally {
              setCompleteJoinLoading(false);
            }
          }}
        >
          <InputGroup>
            <Label>Context and identity are set</Label>
            <Note>Enter your username to join the chat (this may help set up the connection).</Note>
          </InputGroup>
          <InputGroup>
            <Label>Username</Label>
            <Input
              type="text"
              placeholder="e.g. John"
              value={completeJoinUsername}
              onChange={(e) => setCompleteJoinUsername(e.target.value)}
              disabled={completeJoinLoading}
            />
          </InputGroup>
          <Button
            type="submit"
            disabled={completeJoinLoading || !completeJoinUsername.trim()}
          >
            {completeJoinLoading ? "Joining..." : "Join chat"}
          </Button>
          {completeJoinError && <Message type="error">{completeJoinError}</Message>}
          {completeJoinSuccess && <Message type="success">{completeJoinSuccess}</Message>}
        </Form>
      </TabContent>
    );
  }

  const needUsernameStep = true

  return (
    <TabContent>
      <Form onSubmit={handleSubmit}>
        <InputGroup>
          <Label>Node URL</Label>
          <Input
            id="nodeUrl"
            type="text"
            value={nodeUrl || "Loading..."}
            disabled
          />
        </InputGroup>

        <InputGroup>
          <Label>Context</Label>
          <Select
            id="contextSelect"
            value={selectedContextId}
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
            {availableContexts.map((ctx) => (
              <option key={ctx.contextId} value={ctx.contextId}>
                {ctx.contextId.substring(0, 12)}...
              </option>
            ))}
          </Select>
          <Note>
            {availableContexts.length > 0
              ? `${availableContexts.length} context${availableContexts.length !== 1 ? "s" : ""} available`
              : "Connect to a node to see contexts"}
          </Note>
        </InputGroup>

        {!fetchingContexts && availableContexts.length === 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <InputGroup>
              <Label>No contexts yet — join with an invitation</Label>
              <Note>
                Paste an invitation link (web or desktop) or the encoded payload.
              </Note>
              <Input
                id="invitationInput"
                type="text"
                placeholder="https://...?invitation=... or calimero://curb/join?invitation=... or paste encoded"
                value={invitationInput}
                onChange={(e) => {
                  setInvitationInput(e.target.value);
                  setInvitationError("");
                }}
                disabled={submittingInvitation}
              />
              <Button
                type="button"
                variant="primary"
                style={{ width: "100%", marginTop: "0.5rem" }}
                onClick={handleUseInvitation}
                disabled={submittingInvitation || !invitationInput.trim()}
              >
                {submittingInvitation ? "Using invitation..." : "Use invitation"}
              </Button>
              {invitationError && (
                <Message type="error" style={{ marginTop: "0.5rem" }}>
                  {invitationError}
                </Message>
              )}
            </InputGroup>
          </div>
        )}

        {selectedContextId && (
          <InputGroup>
            <Label>Identity</Label>
            <Select
              id="identitySelect"
              value={selectedIdentityId}
              onChange={handleIdentityChange}
              disabled={fetchingIdentities || contextIdentities.length === 0}
            >
              <option value="">
                {fetchingIdentities
                  ? "Loading identities..."
                  : contextIdentities.length === 0
                    ? "No identities"
                    : "Select your identity..."}
              </option>
              {contextIdentities.map((id) => (
                <option key={id} value={id}>
                  {id.substring(0, 12)}...
                </option>
              ))}
            </Select>
          </InputGroup>
        )}

        {(checkingUsername || needUsernameStep) && (
          <>
            {checkingUsername && (
              <Message type="info">Checking if you already joined...</Message>
            )}
            {needUsernameStep && (
              <>
                <InputGroup>
                  <Label>Username</Label>
                  <Note>
                    Choose a unique name to identify you in the chat (can only be
                    set once).
                  </Note>
                  <Input
                    id="username"
                    type="text"
                    placeholder="e.g. John"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isLoading}
                  />
                </InputGroup>
                <Button
                  type="submit"
                  disabled={
                    isLoading ||
                    isDisabled ||
                    !username.trim() ||
                    !selectedContextId ||
                    !selectedIdentityId
                  }
                >
                  {isLoading ? "Joining..." : "Join chat"}
                </Button>
              </>
            )}
          </>
        )}

        {error && <Message type="error">{error}</Message>}
        {success && <Message type="success">{success}</Message>}
      </Form>
    </TabContent>
  );
}
