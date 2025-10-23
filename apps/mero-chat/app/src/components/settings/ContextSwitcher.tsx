import { useEffect, useState } from "react";
import styled from "styled-components";
import {
  getContextId,
  setContextId,
  setExecutorPublicKey,
  apiClient,
  type ResponseData,
} from "@calimero-network/calimero-client";
import type { FetchContextIdentitiesResponse } from "@calimero-network/calimero-client/lib/api/nodeApi";
import { ContextApiDataSource } from "../../api/dataSource/nodeApiDataSource";
import type { ContextInfo } from "../../api/nodeApi";
import { CONTEXT_ID } from "../../constants/config";

const Container = styled.div`
  padding: 1rem;
`;

const Section = styled.div`
  margin-bottom: 1.5rem;
`;

const Label = styled.label`
  display: block;
  color: #b8b8d1;
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 0.5rem;
`;

const Select = styled.select`
  width: 100%;
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #fff;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
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

const CurrentContextInfo = styled.div`
  padding: 1rem;
  background: rgba(124, 58, 237, 0.1);
  border: 1px solid rgba(124, 58, 237, 0.3);
  border-radius: 8px;
  margin-bottom: 1rem;
`;

const InfoRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;

  &:last-child {
    margin-bottom: 0;
  }
`;

const InfoLabel = styled.span`
  color: #b8b8d1;
  font-size: 0.8rem;
`;

const InfoValue = styled.span`
  color: #fff;
  font-size: 0.8rem;
  font-family: monospace;
  word-break: break-all;
  max-width: 60%;
  text-align: right;
`;

const Button = styled.button`
  width: 100%;
  padding: 0.75rem;
  background: #7c3aed;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    background: #6d28d9;
    transform: translateY(-1px);
  }

  &:active:not(:disabled) {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ErrorMessage = styled.div`
  padding: 0.75rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  color: #ef4444;
  font-size: 0.875rem;
  margin-bottom: 1rem;
`;

const LoadingMessage = styled.div`
  padding: 0.75rem;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 8px;
  color: #3b82f6;
  font-size: 0.875rem;
  text-align: center;
`;

const SuccessMessage = styled.div`
  padding: 0.75rem;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 8px;
  color: #22c55e;
  font-size: 0.875rem;
  margin-bottom: 1rem;
`;

const Note = styled.p`
  color: #777583;
  font-size: 0.75rem;
  margin-top: 0.5rem;
  margin-bottom: 0;
  font-style: italic;
`;

export default function ContextSwitcher() {
  const [contexts, setContexts] = useState<ContextInfo[]>([]);
  const [selectedContextId, setSelectedContextId] = useState<string>("");
  const [currentContextId, setCurrentContextId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<string>("");

  useEffect(() => {
    const currentId = getContextId() || CONTEXT_ID || "";
    setCurrentContextId(currentId);
    setSelectedContextId(currentId);
    fetchContexts();
  }, []);

  const fetchContexts = async () => {
    setLoading(true);
    setError("");
    try {
      const nodeApi = new ContextApiDataSource();
      const response = await nodeApi.listContexts();
      if (response.data) {
        setContexts(response.data);
      } else if (response.error) {
        setError(response.error.message || "Failed to fetch contexts");
      }
    } catch (err) {
      setError("Failed to fetch contexts from node");
      console.error("Error fetching contexts:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleContextSwitch = async () => {
    if (!selectedContextId) {
      setError("Please select a context");
      return;
    }

    if (selectedContextId === currentContextId) {
      setError("This context is already active");
      return;
    }

    setLoading(true);
    setError("");
    setSuccess("");

    try {
      // First, fetch the identity for the new context
      const contextIdentityResponse: ResponseData<FetchContextIdentitiesResponse> =
        await apiClient.node().fetchContextIdentities(selectedContextId);

      if (
        !contextIdentityResponse.data ||
        contextIdentityResponse.data.identities.length === 0
      ) {
        setError(
          "You are not a member of this context. Please join the context first.",
        );
        setLoading(false);
        return;
      }

      const contextIdentity = contextIdentityResponse.data.identities[0];

      // Now update both context and identity
      setContextId(selectedContextId);
      setExecutorPublicKey(contextIdentity);

      setSuccess(
        `Switched to context: ${selectedContextId.substring(0, 8)}...`,
      );

      // Reload the page after a short delay to apply the new context
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      console.error("Error switching context:", err);
      setError(
        "Failed to switch context. You may not be a member of this context.",
      );
      setLoading(false);
    }
  };

  const currentContext = contexts.find(
    (ctx) => ctx.contextId === currentContextId,
  );

  return (
    <Container>
      <CurrentContextInfo>
        <InfoRow>
          <InfoLabel>Current Context ID:</InfoLabel>
          <InfoValue>{currentContextId}</InfoValue>
        </InfoRow>
        {currentContext && (
          <>
            <InfoRow>
              <InfoLabel>Application ID:</InfoLabel>
              <InfoValue>
                {currentContext.applicationId.substring(0, 8)}...
              </InfoValue>
            </InfoRow>
            <InfoRow>
              <InfoLabel>Status:</InfoLabel>
              <InfoValue>
                {currentContext.rootHash !== "11111111111111111111111111111111"
                  ? "Synced"
                  : "Not Synced"}
              </InfoValue>
            </InfoRow>
          </>
        )}
      </CurrentContextInfo>

      {error && <ErrorMessage>{error}</ErrorMessage>}
      {success && <SuccessMessage>{success}</SuccessMessage>}

      {loading ? (
        <LoadingMessage>Loading context...</LoadingMessage>
      ) : (
        <>
          <Section>
            <Label htmlFor="context-select">Available Contexts</Label>
            <Select
              id="context-select"
              value={selectedContextId}
              onChange={(e) => {
                setSelectedContextId(e.target.value);
                setError("");
                setSuccess("");
              }}
              disabled={contexts.length === 0}
            >
              <option value="">Select a context...</option>
              {contexts.map((context) => (
                <option key={context.contextId} value={context.contextId}>
                  {context.contextId}
                  {context.contextId === currentContextId ? " (current)" : ""}
                </option>
              ))}
            </Select>
            <Note>
              {contexts.length === 0
                ? "No contexts found on this node"
                : `${contexts.length} context${contexts.length !== 1 ? "s" : ""} available`}
            </Note>
          </Section>

          <Button
            onClick={handleContextSwitch}
            disabled={
              !selectedContextId ||
              selectedContextId === currentContextId ||
              loading
            }
          >
            Switch Context
          </Button>
          <Note style={{ marginTop: "0.5rem", textAlign: "center" }}>
            ⚠️ Switching context will reload the page
          </Note>
        </>
      )}
    </Container>
  );
}
