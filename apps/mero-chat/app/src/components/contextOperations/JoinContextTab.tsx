import React, { useState } from "react";
import { styled } from "styled-components";
import { apiClient } from "@calimero-network/calimero-client";
import type { ResponseData } from "@calimero-network/calimero-client";
import type { JoinContextResponse } from "@calimero-network/calimero-client/lib/api/nodeApi";
import { Button, Input } from "@calimero-network/mero-ui";

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
