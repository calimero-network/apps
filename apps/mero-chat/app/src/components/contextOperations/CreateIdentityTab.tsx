import React, { useState, useEffect } from "react";
import { styled } from "styled-components";
import { apiClient } from "@calimero-network/calimero-client";
import type { ResponseData } from "@calimero-network/calimero-client";
import type { NodeIdentity } from "@calimero-network/calimero-client/lib/api/nodeApi";
import { Button, Input } from "@calimero-network/mero-ui";

const TabContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  text-align: center;
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
`;

const Label = styled.label`
  font-size: 0.7rem;
  font-weight: 500;
  color: #b8b8d1;
  margin-bottom: 0.25rem;
`;

const IdentityDisplay = styled.div`
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 0.5rem;
  margin-top: 0.5rem;
`;

const IdentityTitle = styled.h4`
  color: #ffffff;
  font-size: 0.8rem;
  font-weight: 600;
  margin-bottom: 0.4rem;
`;

const IdentityValue = styled.div`
  display: flex;
  gap: 0.5rem;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 0.5rem;
  font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
  font-size: 0.7rem;
  color: #e0e0e0;
  word-break: break-all;
  margin-bottom: 0.5rem;
  position: relative;
`;

const CopyButton = styled.button`
  background: rgba(255, 255, 255, 0.1);
  width: 60px;
  color: #b8b8d1;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  padding: 0.3rem 0.5rem;
  font-size: 0.6rem;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-right: 0.25rem;

  &:hover {
    background: rgba(255, 255, 255, 0.2);
    color: #ffffff;
  }
`;

const Message = styled.div<{ type?: "success" | "error" }>`
  font-size: 0.8rem;
  text-align: center;
  color: ${({ type }) =>
    type === "success" ? "#27ae60" : type === "error" ? "#e74c3c" : "#b8b8d1"};
`;

export default function CreateIdentityTab() {
  const [identity, setIdentity] = useState<NodeIdentity | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  // Load existing identity from localStorage on component mount
  useEffect(() => {
    const savedIdentity = localStorage.getItem("new-context-identity");
    if (savedIdentity) {
      try {
        const parsedIdentity = JSON.parse(savedIdentity);
        setIdentity(parsedIdentity);
      } catch (error) {
        console.error("Failed to parse saved identity:", error);
      }
    }
  }, []);

  const handleCreateIdentity = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const response: ResponseData<NodeIdentity> = await apiClient
        .node()
        .createNewIdentity();

      if (response.error) {
        setMessage({
          text: response.error.message || "Failed to create identity",
          type: "error",
        });
      } else if (response.data) {
        setIdentity(response.data);
        // Auto-save to localStorage
        localStorage.setItem(
          "new-context-identity",
          JSON.stringify(response.data)
        );
        setMessage({
          text: "Identity created and saved successfully!",
          type: "success",
        });
      }
    } catch (_error) {
      setMessage({
        text: "An error occurred while creating identity",
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage({ text: "Copied to clipboard!", type: "success" });
      setTimeout(() => setMessage(null), 2000);
    } catch (_error) {
      setMessage({ text: "Failed to copy to clipboard", type: "error" });
    }
  };

  return (
    <TabContent>
      {identity && (
        <IdentityDisplay>
          <IdentityTitle>Current Identity</IdentityTitle>
          <InputGroup>
            <Label>Public Key</Label>
            <IdentityValue>
              <Input
                id="publicKey"
                type="text"
                value={identity.publicKey}
                disabled={true}
              />
              <Button
                onClick={() => handleCopyToClipboard(identity.publicKey)}
                variant="secondary"
                style={{ 
                  width: "80px", 
                  minWidth: "80px",
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
              >
                <span>Copy</span>
              </Button>
            </IdentityValue>
          </InputGroup>

          {identity.privateKey && (
            <InputGroup>
              <Label>Private Key</Label>
              <IdentityValue>
                {identity.privateKey}
                <CopyButton
                  onClick={() => handleCopyToClipboard(identity.privateKey)}
                >
                  Copy
                </CopyButton>
              </IdentityValue>
            </InputGroup>
          )}
        </IdentityDisplay>
      )}

      <Button onClick={handleCreateIdentity} disabled={isLoading}>
        {isLoading ? "Creating..." : "Create New Identity"}
      </Button>

      {message && <Message type={message.type}>{message.text}</Message>}
    </TabContent>
  );
}
