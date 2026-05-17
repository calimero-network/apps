import { useState, useEffect, useRef, useCallback } from "react";
import { styled, keyframes } from "styled-components";
import {
  setContextId,
  setContextIdentity as setExecutorPublicKey,
} from "@calimero-network/mero-react";
import type { ResponseData } from "../../api/types";
import {
  nodeApi as apiClientNode,
  type LegacyJoinContextResponse as JoinContextResponse,
  type LegacyNodeIdentity as NodeIdentity,
  type LegacySignedOpenInvitation as SignedOpenInvitation,
} from "../../api/meroJsClient";
import {
  clearInvitationFromStorage,
  getInvitationFromStorage,
} from "../../utils/invitation";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import {
  setGroupId,
  setGroupMemberIdentity,
  setStoredGroupAlias,
  setContextMemberIdentity,
} from "../../constants/config";
import {
  getIdentityDisplayName,
  getMessengerDisplayName,
} from "../../utils/messengerName";
import { parseGroupInvitationPayload } from "../../utils/invitation";

const spin = keyframes`to { transform: rotate(360deg); }`;
const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  backdrop-filter: blur(8px);
`;

const Modal = styled.div`
  background: #111113;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  width: 90%;
  max-width: 400px;
  box-shadow: 0 32px 64px rgba(0, 0, 0, 0.6);
  animation: ${fadeUp} 0.2s ease both;
  overflow: hidden;
`;

const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
`;

const IconBox = styled.div`
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: rgba(165, 255, 17, 0.1);
  border: 1px solid rgba(165, 255, 17, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #a5ff11;
`;

const ErrorIconBox = styled(IconBox)`
  background: rgba(255, 59, 59, 0.07);
  border-color: rgba(255, 59, 59, 0.2);
  color: #ff6b6b;
`;

const ModalTitle = styled.h2`
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  margin: 0;
`;

const Body = styled.div`
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

const StatusRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.82rem;
`;

const Spinner = styled.div`
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid rgba(165, 255, 17, 0.25);
  border-top-color: #a5ff11;
  animation: ${spin} 0.7s linear infinite;
  flex-shrink: 0;
`;

const ErrorBanner = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  padding: 0.75rem 1rem;
  background: rgba(255, 59, 59, 0.07);
  border: 1px solid rgba(255, 59, 59, 0.18);
  border-radius: 8px;
  color: #ff6b6b;
  font-size: 0.82rem;
  line-height: 1.45;
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 0.5rem;
`;

const PrimaryBtn = styled.button`
  flex: 1;
  padding: 0.65rem 1rem;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  background: #a5ff11;
  color: #0a0a0a;
  border: none;
  transition: opacity 0.15s;
  &:hover { opacity: 0.88; }
`;

const SecondaryBtn = styled.button`
  flex: 1;
  padding: 0.65rem 1rem;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: all 0.15s;
  &:hover { background: rgba(255,255,255,0.06); color: #fff; border-color: rgba(255,255,255,0.18); }
`;

type Status =
  | "joining"
  | "syncing"
  | "discovering-contexts"
  | "syncing-context"
  | "error";

interface InvitationHandlerPopupProps {
  onSuccess: () => void;
  onError: () => void;
}

/**
 * Detect whether the stored invitation is a group invitation or a legacy
 * context invitation.
 *
 * Legacy context invitations are JSON objects (SignedOpenInvitation) with
 * `invitation` and `invitee_signature` fields.
 *
 * Group invitations are transparent JSON with `invitation` and
 * `inviter_signature` fields. Legacy context invitations also use JSON, so we
 * inspect the payload shape instead of assuming that JSON always means context.
 */
function isGroupInvitation(payload: string): boolean {
  return !!parseGroupInvitationPayload(payload);
}

export default function InvitationHandlerPopup({
  onSuccess,
  onError,
}: InvitationHandlerPopupProps) {
  const [status, setStatus] = useState<Status>("joining");
  const [statusMessage, setStatusMessage] = useState("Processing your invitation...");
  const [errorMessage, setErrorMessage] = useState("");
  const hasAttemptedJoin = useRef(false);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const joinGroupFlow = useCallback(
    async (invitationPayload: string) => {
      const groupApi = new GroupApiDataSource();

      setStatus("joining");
      setStatusMessage("Joining workspace...");

      const parsedInvitation = parseGroupInvitationPayload(invitationPayload);
      if (!parsedInvitation) {
        throw new Error("Invalid workspace invitation");
      }

      const joinResult = await groupApi.joinGroup({
        invitation: parsedInvitation.invitation,
        groupAlias: parsedInvitation.groupAlias,
      });
      if (joinResult.error || !joinResult.data) {
        throw new Error(
          joinResult.error?.message || "Failed to join workspace",
        );
      }
      const { groupId, memberIdentity } = joinResult.data;
      setGroupId(groupId);
      setGroupMemberIdentity(groupId, memberIdentity);
      if (parsedInvitation.groupAlias?.trim()) {
        setStoredGroupAlias(groupId, parsedInvitation.groupAlias);
      }

      setStatus("syncing");
      setStatusMessage("Syncing workspace data...");

      await groupApi.syncGroup(groupId);

      setStatus("discovering-contexts");
      setStatusMessage("Loading workspace channels...");
      const contextsResult = await groupApi.listGroupContexts(groupId);
      if (contextsResult.error || !contextsResult.data) {
        throw new Error(
          contextsResult.error?.message || "Failed to list workspace channels",
        );
      }

      const contextEntries = contextsResult.data;

      if (contextEntries.length > 0) {
        setStatus("syncing-context");
        setStatusMessage(`Joining ${contextEntries.length} channel(s)...`);

        // Seed each newly-joined context with a server-side member alias so
        // other members see a display name instead of a raw identity hash
        // (papers over the rc.35 governance gap until the upstream fix lands).
        const seedAlias =
          getIdentityDisplayName(memberIdentity) ||
          getMessengerDisplayName() ||
          "";

        for (const entry of contextEntries) {
          try {
            const joinCtxResult = await groupApi.joinGroupContext(groupId, {
              contextId: entry.contextId,
            });
            const memberKey = joinCtxResult.data?.memberPublicKey;
            if (memberKey) {
              setContextMemberIdentity(entry.contextId, memberKey);
              if (seedAlias) {
                groupApi
                  .setMemberMetadata(entry.contextId, memberKey, { name: seedAlias })
                  .catch(() => {/* non-fatal — alias is best-effort */});
              }
            }
          } catch {
            // Best-effort: failing to join one context shouldn't block workspace entry
          }
        }
      }

      setStatusMessage(
        contextEntries.length > 0
          ? "Workspace joined. Choose a channel next."
          : "Workspace joined. No channels are available yet.",
      );
      clearInvitationFromStorage();
      onSuccess();
    },
    [onSuccess],
  );

  const waitForContextSync = useCallback(
    (contextId: string) =>
      new Promise<void>((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 60;

        syncIntervalRef.current = setInterval(async () => {
          attempts++;
          if (attempts > maxAttempts) {
            if (syncIntervalRef.current)
              clearInterval(syncIntervalRef.current);
            reject(
              new Error("Context sync timeout — please try again later"),
            );
            return;
          }

          try {
            const verifyResponse = await apiClientNode
              .getContext(contextId);
            if (verifyResponse.data) {
              const isSynced =
                verifyResponse.data.rootHash !==
                "11111111111111111111111111111111";
              if (isSynced) {
                if (syncIntervalRef.current)
                  clearInterval(syncIntervalRef.current);
                clearInvitationFromStorage();
                onSuccess();
                resolve();
              }
            }
          } catch (err) {
            console.error("Error checking sync status:", err);
          }
        }, 3000);
      }).catch((error) => {
        setErrorMessage(
          error instanceof Error ? error.message : "Sync failed",
        );
        setStatus("error");
      }),
    [onSuccess],
  );

  const joinContextFlow = useCallback(
    async (invitationPayload: string) => {
      setStatus("joining");
      setStatusMessage("Creating identity...");

      const identityResponse: ResponseData<NodeIdentity> = await apiClientNode
        .createNewIdentity();
      if (identityResponse.error || !identityResponse.data) {
        throw new Error(
          identityResponse.error?.message ||
            "Failed to create identity for invitation",
        );
      }

      const identityPayload = identityResponse.data as
        | NodeIdentity
        | { data?: NodeIdentity };
      const identityData: NodeIdentity =
        "data" in identityPayload && identityPayload.data
          ? identityPayload.data
          : (identityPayload as NodeIdentity);
      const executorPk: string = identityData.publicKey;

      setStatusMessage("Joining context...");

      const parsed = JSON.parse(invitationPayload.trim());
      const signedInvitation: SignedOpenInvitation = parsed.data ?? parsed;

      const joinResponse: ResponseData<JoinContextResponse> = await apiClientNode
        .joinContextByOpenInvitation(signedInvitation, executorPk);
      if (joinResponse.error || !joinResponse.data) {
        throw new Error(
          joinResponse.error?.message || "Failed to join context",
        );
      }

      const verifyResponse = await apiClientNode
        .getContext(joinResponse.data.contextId);
      if (verifyResponse.error || !verifyResponse.data) {
        throw new Error("Failed to verify context");
      }

      localStorage.setItem(
        "new-context-identity",
        JSON.stringify(identityData),
      );
      setContextId(joinResponse.data.contextId);
      setExecutorPublicKey(executorPk);

      setStatus("syncing-context");
      setStatusMessage("Waiting for context to sync...");

      await waitForContextSync(joinResponse.data.contextId);
    },
    [waitForContextSync],
  );

  const processInvitation = useCallback(async () => {
    if (hasAttemptedJoin.current) return;
    hasAttemptedJoin.current = true;

    try {
      const invitationPayload = getInvitationFromStorage();
      if (!invitationPayload) {
        setErrorMessage("No invitation found");
        setStatus("error");
        return;
      }

      if (isGroupInvitation(invitationPayload)) {
        await joinGroupFlow(invitationPayload);
      } else {
        await joinContextFlow(invitationPayload);
      }
    } catch (error) {
      console.error("Invitation join error:", error);
      setErrorMessage(
        error instanceof Error ? error.message : "An unexpected error occurred",
      );
      setStatus("error");
    }
  }, [joinGroupFlow, joinContextFlow]);

  useEffect(() => {
    processInvitation();
    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, [processInvitation]);

  const handleRetry = () => {
    hasAttemptedJoin.current = false;
    setErrorMessage("");
    setStatus("joining");
    processInvitation();
  };

  const handleCancel = () => {
    clearInvitationFromStorage();
    onError();
  };

  const progressTitle =
    status === "joining" ? "Joining workspace…"
    : status === "syncing" ? "Syncing workspace…"
    : status === "discovering-contexts" ? "Loading channels…"
    : "Syncing channel…";

  return (
    <Overlay>
      <Modal>
        <ModalHeader>
          {status === "error" ? (
            <ErrorIconBox>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </ErrorIconBox>
          ) : (
            <IconBox>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <line x1="19" y1="8" x2="19" y2="14" />
                <line x1="22" y1="11" x2="16" y2="11" />
              </svg>
            </IconBox>
          )}
          <ModalTitle>{status === "error" ? "Join failed" : progressTitle}</ModalTitle>
        </ModalHeader>

        <Body>
          {status !== "error" && (
            <StatusRow>
              <Spinner />
              {statusMessage}
            </StatusRow>
          )}

          {status === "error" && (
            <>
              <ErrorBanner>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {errorMessage}
              </ErrorBanner>
              <ButtonRow>
                <PrimaryBtn onClick={handleRetry}>Retry</PrimaryBtn>
                <SecondaryBtn onClick={handleCancel}>Cancel</SecondaryBtn>
              </ButtonRow>
            </>
          )}
        </Body>
      </Modal>
    </Overlay>
  );
}
