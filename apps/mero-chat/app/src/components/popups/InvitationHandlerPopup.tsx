import React, { useState, useEffect, useRef, useCallback } from "react";
import { styled } from "styled-components";
import { apiClient, type ResponseData, setContextId, setExecutorPublicKey } from "@calimero-network/calimero-client";
import type {
  JoinContextResponse,
  NodeIdentity,
  SignedOpenInvitation,
} from "@calimero-network/calimero-client/lib/api/nodeApi";
import { Button } from "@calimero-network/mero-ui";
import { clearInvitationFromStorage, getInvitationFromStorage } from "../../utils/invitation";

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  backdrop-filter: blur(8px);
`;

const PopupContainer = styled.div`
  background: #1a1a1f;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 2rem;
  width: 90%;
  max-width: 450px;
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
`;

const Title = styled.h2`
  color: #ffffff;
  font-size: 1.4rem;
  font-weight: 600;
  margin-bottom: 1rem;
  text-align: center;
`;

const Message = styled.div<{ type?: "success" | "error" | "info" }>`
  padding: 0.75rem;
  border-radius: 6px;
  font-size: 0.85rem;
  text-align: center;
  margin-bottom: 1rem;
  color: ${({ type }) =>
    type === "success"
      ? "#27ae60"
      : type === "error"
      ? "#e74c3c"
      : "#b8b8d1"};
  background: ${({ type }) =>
    type === "success"
      ? "rgba(39, 174, 96, 0.1)"
      : type === "error"
      ? "rgba(231, 76, 60, 0.1)"
      : "rgba(184, 184, 209, 0.1)"};
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
`;

interface InvitationHandlerPopupProps {
  onSuccess: () => void;
  onError: () => void;
}

export default function InvitationHandlerPopup({ onSuccess, onError }: InvitationHandlerPopupProps) {
  const [status, setStatus] = useState<"joining" | "syncing" | "error">("joining");
  const [errorMessage, setErrorMessage] = useState("");
  const hasAttemptedJoin = useRef(false);
  // @ts-expect-error - NodeJS.Timeout is not defined in the browser
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const joinContextWithInvitation = useCallback(async () => {
    // Prevent multiple calls
    if (hasAttemptedJoin.current) {
      return;
    }
    hasAttemptedJoin.current = true;
    try {
      const invitationPayload = getInvitationFromStorage();
      if (!invitationPayload) {
        setErrorMessage("No invitation found");
        setStatus("error");
        return;
      }

      // Create new identity for this invitation (user already has JWT token from authentication)
      const identityResponse: ResponseData<NodeIdentity> = await apiClient
        .node()
        .createNewIdentity();

      if (identityResponse.error || !identityResponse.data) {
        setErrorMessage(
          identityResponse.error?.message || "Failed to create identity for invitation"
        );
        setStatus("error");
        return;
      }

      const executorPublicKey = identityResponse.data.publicKey;

      // Join context using the invitation
      const joinResponse: ResponseData<JoinContextResponse> = await apiClient
        .node()
        .joinContextByOpenInvitation(
          JSON.parse(invitationPayload.trim()) as SignedOpenInvitation,
          executorPublicKey
        );

      if (joinResponse.error || !joinResponse.data) {
        setErrorMessage(joinResponse.error?.message || "Failed to join context");
        setStatus("error");
        return;
      }

      // Verify the context
      const verifyContextResponse = await apiClient
        .node()
        .getContext(joinResponse.data.contextId);

      if (verifyContextResponse.error || !verifyContextResponse.data) {
        setErrorMessage("Failed to verify context");
        setStatus("error");
        return;
      }

      // Store the new context data
      localStorage.setItem("new-context-identity", JSON.stringify(identityResponse.data));
      setContextId(joinResponse.data.contextId);
      setExecutorPublicKey(executorPublicKey);
      
      // Wait for context to sync before closing
      setStatus("syncing");
      await waitForContextSync(joinResponse.data.contextId);
    } catch (error) {
      console.error("Invitation join error:", error);
      setErrorMessage(
        error instanceof Error ? error.message : "An unexpected error occurred"
      );
      setStatus("error");
    }
  }, [onSuccess]);

  const waitForContextSync = useCallback(async (contextId: string) => {
    return new Promise<void>((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 60; // 3 minutes max (60 * 3 seconds)

      syncIntervalRef.current = setInterval(async () => {
        attempts++;

        if (attempts > maxAttempts) {
          if (syncIntervalRef.current) {
            clearInterval(syncIntervalRef.current);
          }
          reject(new Error("Context sync timeout - please try again later"));
          return;
        }

        try {
          const verifyResponse = await apiClient
            .node()
            .getContext(contextId);

          if (verifyResponse.data) {
            const isSynced = verifyResponse.data.rootHash !== "11111111111111111111111111111111";
            
            if (isSynced) {
              if (syncIntervalRef.current) {
                clearInterval(syncIntervalRef.current);
              }
              // Clear invitation and close popup - context is now ready
              clearInvitationFromStorage();
              onSuccess();
              resolve();
            }
          }
        } catch (error) {
          console.error("Error checking sync status:", error);
        }
      }, 3000); // Check every 3 seconds
    }).catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : "Sync failed");
      setStatus("error");
    });
  }, [onSuccess]);

  useEffect(() => {
    // Automatically join context on mount (user is already authenticated with JWT)
    joinContextWithInvitation();

    // Cleanup sync interval on unmount
    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [joinContextWithInvitation]);

  const handleRetry = () => {
    // Reset the ref to allow retry
    hasAttemptedJoin.current = false;
    setErrorMessage("");
    setStatus("joining");
    joinContextWithInvitation();
  };

  const handleCancel = () => {
    clearInvitationFromStorage();
    onError();
  };

  return (
    <Overlay>
      <PopupContainer>
        {status === "joining" && (
          <>
            <Title>Joining the invitation...</Title>
            <Message type="info">
              Please wait while we process your invitation.
            </Message>
          </>
        )}

        {status === "syncing" && (
          <>
            <Title>Syncing context...</Title>
            <Message type="info">
              Please wait while the context state is syncing. This may take a moment.
            </Message>
          </>
        )}

        {status === "error" && (
          <>
            <Title>Context Join Failed</Title>
            <Message type="error">{errorMessage}</Message>
            <ButtonGroup>
              <Button
                onClick={handleRetry}
                variant="primary"
                style={{ flex: 1 }}
              >
                Retry Again
              </Button>
              <Button
                onClick={handleCancel}
                variant="secondary"
                style={{ flex: 1 }}
              >
                Cancel
              </Button>
            </ButtonGroup>
          </>
        )}
      </PopupContainer>
    </Overlay>
  );
}

