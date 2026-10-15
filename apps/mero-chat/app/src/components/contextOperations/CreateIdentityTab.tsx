import React, { useState } from "react";
import { styled } from "styled-components";
import type { ResponseData } from "../../api/types";
import {
  nodeApi as apiClientNode,
  type LegacyNodeIdentity as NodeIdentity,
} from "../../api/meroJsClient";
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
  color: var(--glass-ink-2);
  margin-bottom: 0.25rem;
`;

const IdentityDisplay = styled.div`
  border: 1px solid color-mix(in srgb, var(--glass-ink) 10%, transparent);
  border-radius: 10px;
  padding: 0.5rem;
  margin-top: 0.5rem;
`;

const IdentityTitle = styled.h4`
  color: var(--glass-ink);
  font-size: 0.8rem;
  font-weight: 600;
  margin-bottom: 0.4rem;
`;

const IdentityValue = styled.div`
  display: flex;
  gap: 0.5rem;
  align-items: center;
  border: 1px solid color-mix(in srgb, var(--glass-ink) 10%, transparent);
  border-radius: 8px;
  padding: 0.5rem;
  font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
  font-size: 0.7rem;
  color: var(--glass-ink);
  word-break: break-all;
  margin-bottom: 0.5rem;
  position: relative;
`;

const CopyButton = styled.button`
  background: color-mix(in srgb, var(--glass-ink) 10%, transparent);
  width: 60px;
  color: var(--glass-ink-2);
  border: 1px solid color-mix(in srgb, var(--glass-ink) 20%, transparent);
  border-radius: 3px;
  padding: 0.3rem 0.5rem;
  font-size: 0.6rem;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-right: 0.25rem;

  &:hover {
    background: color-mix(in srgb, var(--glass-ink) 20%, transparent);
    color: var(--glass-ink);
  }
`;

const Message = styled.div<{ type?: "success" | "error" }>`
  font-size: 0.8rem;
  text-align: center;
  color: ${({ type }) =>
    type === "success" ? "#27ae60" : type === "error" ? "#e74c3c" : "var(--glass-ink-2)"};
`;

export default function CreateIdentityTab() {
  const [identity, setIdentity] = useState<NodeIdentity | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  const handleCreateIdentity = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const response: ResponseData<NodeIdentity> = await apiClientNode
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
          JSON.stringify(response.data),
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
                style={{ backgroundColor: "var(--glass-surface-solid)", color: "var(--glass-ink)", borderColor: "var(--glass-line-strong)",
                  width: "80px",
                  minWidth: "80px",
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
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
