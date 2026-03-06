import React, { useState, useEffect } from "react";
import { styled, keyframes } from "styled-components";
import {
  apiClient,
  getContextId,
  getExecutorPublicKey,
} from "@calimero-network/calimero-client";
import type { ResponseData } from "@calimero-network/calimero-client";
import type { ContextInviteByOpenInvitationResponse } from "@calimero-network/calimero-client/lib/api/nodeApi";
import {
  generateInvitationUrl,
  generateInvitationDeepLink,
} from "../../utils/invitation";

// ─── Animations ────────────────────────────────────────────────────────────────

const shimmer = keyframes`
  0%   { background-position: -200% center; }
  100% { background-position:  200% center; }
`;

const fadeSlideIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const checkPop = keyframes`
  0%   { transform: scale(0.5); opacity: 0; }
  70%  { transform: scale(1.15); }
  100% { transform: scale(1); opacity: 1; }
`;

// ─── Styled components ─────────────────────────────────────────────────────────

const TabContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  animation: ${fadeSlideIn} 0.2s ease both;
`;

const InfoCard = styled.div`
  background: rgba(165, 255, 17, 0.03);
  border: 1px solid rgba(165, 255, 17, 0.1);
  border-radius: 10px;
  padding: 0.875rem;
`;

const CardLabel = styled.div`
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(165, 255, 17, 0.5);
  margin-bottom: 0.625rem;
`;

const FieldRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-bottom: 0.5rem;

  &:last-child {
    margin-bottom: 0;
  }
`;

const FieldLabel = styled.label`
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.3);
  font-weight: 500;
`;

const FieldValue = styled.div`
  font-family: "SF Mono", "Fira Code", "Consolas", monospace;
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.55);
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  padding: 0.35rem 0.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

// ── Success state ──────────────────────────────────────────────────────────────

const SuccessCard = styled.div`
  background: rgba(165, 255, 17, 0.04);
  border: 1px solid rgba(165, 255, 17, 0.15);
  border-radius: 10px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
`;

const SuccessHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid rgba(165, 255, 17, 0.1);
`;

const CheckIcon = styled.div`
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(165, 255, 17, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: ${checkPop} 0.35s ease both;

  svg { stroke: #a5ff11; }
`;

const SuccessText = styled.span`
  font-size: 0.8rem;
  font-weight: 600;
  color: rgba(165, 255, 17, 0.9);
`;

const LinkBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
`;

const LinkLabel = styled.div`
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.3);
  font-weight: 500;
`;

const LinkRow = styled.div`
  display: flex;
  gap: 0.375rem;
`;

const LinkInput = styled.input`
  flex: 1;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 7px;
  padding: 0.4rem 0.625rem;
  font-family: "SF Mono", "Fira Code", "Consolas", monospace;
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.5);
  outline: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;

  &:focus {
    border-color: rgba(165, 255, 17, 0.2);
  }
`;

const CopyButton = styled.button<{ $copied?: boolean }>`
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem 0.75rem;
  border-radius: 7px;
  border: 1px solid ${p => p.$copied ? "rgba(165,255,17,0.35)" : "rgba(165,255,17,0.2)"};
  background: ${p => p.$copied ? "rgba(165,255,17,0.12)" : "rgba(165,255,17,0.06)"};
  color: ${p => p.$copied ? "#a5ff11" : "rgba(165,255,17,0.7)"};
  font-size: 0.72rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    border-color: rgba(165, 255, 17, 0.4);
    background: rgba(165, 255, 17, 0.1);
    color: #a5ff11;
  }
`;

// ── Generate button + feedback ─────────────────────────────────────────────────

const GenerateButton = styled.button<{ $loading?: boolean }>`
  width: 100%;
  padding: 0.625rem;
  border-radius: 8px;
  border: 1px solid rgba(165, 255, 17, 0.25);
  background: ${p => p.$loading
    ? "rgba(165,255,17,0.06)"
    : "linear-gradient(135deg, rgba(165,255,17,0.12) 0%, rgba(165,255,17,0.06) 100%)"};
  color: ${p => p.$loading ? "rgba(165,255,17,0.5)" : "rgba(165,255,17,0.9)"};
  font-size: 0.82rem;
  font-weight: 600;
  cursor: ${p => p.$loading ? "default" : "pointer"};
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition: all 0.15s ease;
  letter-spacing: 0.01em;

  background-size: 200% auto;
  animation: ${p => p.$loading ? "none" : shimmer} 4s linear infinite;

  &:hover:not(:disabled) {
    border-color: rgba(165, 255, 17, 0.45);
    background: rgba(165, 255, 17, 0.15);
    color: #a5ff11;
  }

  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
`;

const Spinner = styled.span`
  display: inline-block;
  width: 13px;
  height: 13px;
  border: 1.5px solid rgba(165, 255, 17, 0.2);
  border-top-color: rgba(165, 255, 17, 0.7);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

const ErrorMsg = styled.div`
  background: rgba(255, 80, 80, 0.06);
  border: 1px solid rgba(255, 80, 80, 0.15);
  border-radius: 7px;
  padding: 0.5rem 0.75rem;
  font-size: 0.76rem;
  color: rgba(255, 100, 100, 0.8);
  text-align: center;
`;

// ─── Component ─────────────────────────────────────────────────────────────────

export default function InviteToContextTab() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configData, setConfigData] = useState({
    contextId: "",
    executorPublicKey: "",
  });
  const [invitation, setInvitation] = useState<string | null>(null);
  const [invitationWebUrl, setInvitationWebUrl] = useState<string | null>(null);
  const [invitationDesktopLink, setInvitationDesktopLink] = useState<string | null>(null);
  const [copiedWeb, setCopiedWeb] = useState(false);
  const [copiedDesktop, setCopiedDesktop] = useState(false);

  useEffect(() => {
    const storedContextId = getContextId();
    const storedExecutorPublicKey = getExecutorPublicKey();
    if (storedContextId && storedExecutorPublicKey) {
      setConfigData({ contextId: storedContextId, executorPublicKey: storedExecutorPublicKey });
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configData.contextId || !configData.executorPublicKey) {
      setError("Context configuration not found. Please set up context first.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response: ResponseData<ContextInviteByOpenInvitationResponse> =
        await apiClient.node().contextInviteByOpenInvitation(
          configData.contextId,
          configData.executorPublicKey,
          86400,
        );
      if (response.error) {
        setError(response.error.message || "Failed to generate invitation");
      } else {
        const payload = JSON.stringify(response.data);
        setInvitation(payload);
        setInvitationWebUrl(generateInvitationUrl(payload));
        setInvitationDesktopLink(generateInvitationDeepLink(payload));
      }
    } catch {
      setError("An error occurred while generating invitation");
    } finally {
      setIsLoading(false);
    }
  };

  const copy = async (text: string, which: "web" | "desktop") => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === "web") {
        setCopiedWeb(true);
        setTimeout(() => setCopiedWeb(false), 2000);
      } else {
        setCopiedDesktop(true);
        setTimeout(() => setCopiedDesktop(false), 2000);
      }
    } catch {
      // ignore
    }
  };

  return (
    <TabContent>
      {/* Context info */}
      <InfoCard>
        <CardLabel>Context</CardLabel>
        <FieldRow>
          <FieldLabel>Context ID</FieldLabel>
          <FieldValue title={configData.contextId}>
            {configData.contextId || "Not configured"}
          </FieldValue>
        </FieldRow>
        <FieldRow>
          <FieldLabel>Executor Key</FieldLabel>
          <FieldValue title={configData.executorPublicKey}>
            {configData.executorPublicKey || "Not configured"}
          </FieldValue>
        </FieldRow>
      </InfoCard>

      {/* Invitation result */}
      {invitation && invitationWebUrl && invitationDesktopLink ? (
        <SuccessCard>
          <SuccessHeader>
            <CheckIcon>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </CheckIcon>
            <SuccessText>Invitation created</SuccessText>
          </SuccessHeader>

          <LinkBlock>
            <LinkLabel>Web link</LinkLabel>
            <LinkRow>
              <LinkInput readOnly value={invitationWebUrl} />
              <CopyButton $copied={copiedWeb} onClick={() => copy(invitationWebUrl, "web")}>
                {copiedWeb ? (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    Copy
                  </>
                )}
              </CopyButton>
            </LinkRow>
          </LinkBlock>

          <LinkBlock>
            <LinkLabel>Desktop link</LinkLabel>
            <LinkRow>
              <LinkInput readOnly value={invitationDesktopLink} />
              <CopyButton $copied={copiedDesktop} onClick={() => copy(invitationDesktopLink, "desktop")}>
                {copiedDesktop ? (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    Copy
                  </>
                )}
              </CopyButton>
            </LinkRow>
          </LinkBlock>

          <GenerateButton type="button" onClick={handleSubmit} disabled={isLoading}>
            Regenerate
          </GenerateButton>
        </SuccessCard>
      ) : (
        <form onSubmit={handleSubmit}>
          <GenerateButton type="submit" $loading={isLoading} disabled={isLoading}>
            {isLoading ? (
              <><Spinner /> Generating…</>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                Generate Invitation Link
              </>
            )}
          </GenerateButton>
          {error && <ErrorMsg style={{ marginTop: "0.625rem" }}>{error}</ErrorMsg>}
        </form>
      )}
    </TabContent>
  );
}
