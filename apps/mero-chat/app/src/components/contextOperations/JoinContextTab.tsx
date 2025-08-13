import React, { useState } from "react";
import { styled } from "styled-components";
import { apiClient } from "@calimero-network/calimero-client";
import type { ResponseData } from "@calimero-network/calimero-client";
import type { JoinContextResponse } from "@calimero-network/calimero-client/lib/api/nodeApi";

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

const Button = styled.button`
  background: #111;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: white;
  padding: 0.75rem;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;

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
    type === "success" ? "#27ae60" : type === "error" ? "#e74c3c" : "#b8b8d1"};
`;

export default function JoinContextTab() {
  const [invitationPayload, setInvitationPayload] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invitationPayload.trim()) {
      setMessage({ text: "Please fill in all fields", type: "error" });
      return;
    }

    setIsLoading(true);
    setMessage(null);

    const executorPublicKey = localStorage.getItem("new-context-identity");

    if (!executorPublicKey) {
      setMessage({ text: "Please create an identity first", type: "error" });
      return;
    }

    try {
      const response: ResponseData<JoinContextResponse> = await apiClient
        .node()
        .joinContext(invitationPayload.trim());

      if (response.error) {
        setMessage({
          text: response.error.message || "Failed to join context",
          type: "error",
        });
      } else {
        setMessage({ text: "Successfully joined context!", type: "success" });
        setInvitationPayload("");
      }
    } catch (_error) {
      setMessage({
        text: "An error occurred while joining context",
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <TabContent>
      <Form onSubmit={handleSubmit}>
        <InputGroup>
          <Label htmlFor="invitationPayload">Invitation Payload</Label>
          <Input
            id="invitationPayload"
            type="text"
            placeholder="Enter invitation payload"
            value={invitationPayload}
            onChange={(e) => setInvitationPayload(e.target.value)}
            disabled={isLoading}
          />
        </InputGroup>

        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Joining..." : "Join Context"}
        </Button>

        {message && <Message type={message.type}>{message.text}</Message>}
      </Form>
    </TabContent>
  );
}
