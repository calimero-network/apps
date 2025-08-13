import React, { useState, useEffect } from "react";
import { styled } from "styled-components";
import { apiClient, getContextId, getExecutorPublicKey } from "@calimero-network/calimero-client";
import type { ResponseData } from "@calimero-network/calimero-client";

const TabContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 1rem;
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

const Input = styled.input`
  background: rgba(60, 60, 75, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 0.75rem;
  font-size: 0.9rem;
  color: #e0e0e0;
  font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;

  &:focus {
    outline: none;
    border-color: rgba(255, 255, 255, 0.3);
  }

  &::placeholder {
    color: #888;
  }
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
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: white;
  padding: 0.75rem;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;

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
  padding: 0.75rem;
  border-radius: 6px;
  font-size: 0.9rem;
  text-align: center;
  color: ${({ type }) =>
    type === "success"
      ? "#27ae60"
      : type === "error"
      ? "#e74c3c"
      : "#b8b8d1"};
`;

const ConfigInfo = styled.div`
  background: rgba(40, 40, 55, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
`;

const ConfigTitle = styled.h4`
  color: #ffffff;
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
`;

export default function InviteToContextTab() {
  const [inviteeId, setInviteeId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [configData, setConfigData] = useState({
    contextId: "",
    executorPublicKey: "",
  });
  const [invitationPayload, setInvitationPayload] = useState<string | null>(null);

  useEffect(() => {
    const storedContextId = getContextId();;
    const storedExecutorPublicKey = getExecutorPublicKey();
    
    if (storedContextId && storedExecutorPublicKey) {
      setConfigData({
        contextId: storedContextId,
        executorPublicKey: storedExecutorPublicKey,
      });
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteeId.trim()) {
      setMessage({ text: "Please enter invitee ID", type: "error" });
      return;
    }

    if (!configData.contextId || !configData.executorPublicKey) {
      setMessage({ text: "Context configuration not found. Please set up context first.", type: "error" });
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const response: ResponseData<string> = await apiClient.node().contextInvite(
        configData.contextId,
        configData.executorPublicKey,
        inviteeId.trim()
      );

      if (response.error) {
        setMessage({ text: response.error.message || "Failed to invite to context", type: "error" });
      } else {
        setInvitationPayload(response.data);
        setMessage({ text: "Successfully invited to context!", type: "success" });
        setInviteeId("");
      }
    } catch (_error) {
      setMessage({ text: "An error occurred while inviting to context", type: "error" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <TabContent>
      {invitationPayload ? (
        <ConfigInfo>
          <ConfigTitle>Invitation Payload</ConfigTitle>
          <InputGroup>
            <Label>Generated Invitation</Label>
            <ConfigBox>{invitationPayload}</ConfigBox>
          </InputGroup>
        </ConfigInfo>
      ) : (
        <ConfigInfo>
          <ConfigTitle>Context Configuration</ConfigTitle>
          <InputGroup>
            <Label>Context ID</Label>
            <ConfigBox>{configData.contextId || "Not found in localStorage"}</ConfigBox>
          </InputGroup>
          <InputGroup>
            <Label>Executor Public Key</Label>
            <ConfigBox>{configData.executorPublicKey || "Not found in localStorage"}</ConfigBox>
          </InputGroup>
        </ConfigInfo>
      )}

      <Form onSubmit={handleSubmit}>
        <InputGroup>
          <Label htmlFor="inviteeId">Invitee ID</Label>
          <Input
            id="inviteeId"
            type="text"
            placeholder="Enter invitee ID"
            value={inviteeId}
            onChange={(e) => setInviteeId(e.target.value)}
            disabled={isLoading}
          />
        </InputGroup>

        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Inviting..." : "Invite to Context"}
        </Button>

        {message && (
          <Message type={message.type}>
            {message.text}
          </Message>
        )}
      </Form>
    </TabContent>
  );
}
