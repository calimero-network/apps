import React, { useState } from "react";
import { styled } from "styled-components";
import { apiClient, type ResponseData } from "@calimero-network/calimero-client";
import type {
  JoinContextResponse,
  NodeIdentity,
  SignedOpenInvitation,
} from "@calimero-network/calimero-client/lib/api/nodeApi";
import { Button, Input } from "@calimero-network/mero-ui";

const TabContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
`;

const Label = styled.label`
  font-size: 0.7rem;
  font-weight: 500;
  color: #b8b8d1;
`;

const Message = styled.div<{ type?: "success" | "error" }>`
  padding: 0.5rem;
  border-radius: 6px;
  font-size: 0.7rem;
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

    let executorPublicKey = "";

    const response: ResponseData<NodeIdentity> = await apiClient
      .node()
      .createNewIdentity();

    if (response.error) {
      setMessage({
        text:
          response.error.message ||
          "Failed to create identity for this invitation",
        type: "error",
      });
    } else if (response.data) {
      executorPublicKey = response.data.publicKey;
      // Auto-save to localStorage
      localStorage.setItem(
        "new-context-identity",
        JSON.stringify(response.data)
      );
    }

    if (!executorPublicKey) {
      setMessage({ text: "Please create an identity first", type: "error" });
      return;
    }

    try {
      const response: ResponseData<JoinContextResponse> = await apiClient
        .node()
        .joinContextByOpenInvitation(
          JSON.parse(invitationPayload.trim()) as SignedOpenInvitation,
          executorPublicKey
        );

      if (response.error) {
        setMessage({
          text: response.error.message || "Failed to join context",
          type: "error",
        });
      } else {
        setMessage({ text: "Successfully joined context!", type: "success" });
        setInvitationPayload("");
      }
    } catch (error) {
      console.error(error);
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
          <Label htmlFor="invitationPayload">Invitation</Label>
          <Input
            id="invitationPayload"
            type="text"
            placeholder="Enter invitation"
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
