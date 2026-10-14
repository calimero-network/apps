import { useEffect, useMemo, useState } from "react";
import { styled, keyframes } from "styled-components";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import {
  generateInvitationUrl,
  serializeGroupInvitationPayload,
} from "../../utils/invitation";

const spin = keyframes`to { transform: rotate(360deg); }`;
const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: var(--chat-scrim);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  backdrop-filter: blur(8px);
`;

const Modal = styled.div`
  background: var(--glass-surface-solid);
  border: 1px solid color-mix(in srgb, var(--glass-ink) 8%, transparent);
  border-radius: 14px;
  width: 90%;
  max-width: 460px;
  box-shadow: var(--chat-dialog-shadow);
  animation: ${fadeUp} 0.2s ease both;
  overflow: hidden;
`;

const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid color-mix(in srgb, var(--glass-ink) 7%, transparent);
`;

const IconBox = styled.div`
  width: 34px;
  height: 34px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--glass-accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--glass-accent) 20%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--glass-accent);
`;

const HeaderText = styled.div`
  flex: 1;
  min-width: 0;
`;

const ModalTitle = styled.h2`
  color: var(--glass-ink);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  margin: 0 0 0.1rem;
`;

const ModalSub = styled.p`
  color: color-mix(in srgb, var(--glass-ink) 35%, transparent);
  font-size: 0.72rem;
  margin: 0;
  line-height: 1.4;
`;

const CloseBtn = styled.button`
  background: transparent;
  border: none;
  color: color-mix(in srgb, var(--glass-ink) 30%, transparent);
  cursor: pointer;
  padding: 4px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, background 0.15s;
  flex-shrink: 0;
  &:hover { color: var(--glass-ink); background: color-mix(in srgb, var(--glass-ink) 8%, transparent); }
`;

const Body = styled.div`
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
`;

const LoadingRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  background: color-mix(in srgb, var(--glass-ink) 3%, transparent);
  border: 1px solid color-mix(in srgb, var(--glass-ink) 7%, transparent);
  border-radius: 12px;
  color: color-mix(in srgb, var(--glass-ink) 50%, transparent);
  font-size: 0.82rem;
`;

const Spinner = styled.div`
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--glass-accent) 25%, transparent);
  border-top-color: var(--glass-accent);
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
  border-radius: 12px;
  color: var(--glass-bad-ink);
  font-size: 0.82rem;
  line-height: 1.4;
`;

const CopyBtn = styled.button<{ $copied: boolean }>`
  width: 100%;
  padding: 0.6rem 1rem;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid ${({ $copied }) =>
    $copied ? "color-mix(in srgb, var(--glass-accent) 35%, transparent)" : "color-mix(in srgb, var(--glass-ink) 10%, transparent)"};
  background: ${({ $copied }) =>
    $copied ? "color-mix(in srgb, var(--glass-accent) 10%, transparent)" : "color-mix(in srgb, var(--glass-ink) 5%, transparent)"};
  color: ${({ $copied }) => ($copied ? "var(--glass-accent)" : "color-mix(in srgb, var(--glass-ink) 70%, transparent)")};

  &:hover {
    background: ${({ $copied }) =>
      $copied ? "color-mix(in srgb, var(--glass-accent) 12%, transparent)" : "color-mix(in srgb, var(--glass-ink) 8%, transparent)"};
    color: ${({ $copied }) => ($copied ? "var(--glass-accent)" : "var(--glass-ink)")};
    border-color: ${({ $copied }) =>
      $copied ? "color-mix(in srgb, var(--glass-accent) 40%, transparent)" : "color-mix(in srgb, var(--glass-ink) 18%, transparent)"};
  }
`;

const DoneBtn = styled.button`
  width: 100%;
  padding: 0.65rem 1rem;
  border-radius: 12px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  background: var(--glass-ink);
  color: var(--glass-on-ink);
  border: none;
  transition: opacity 0.15s;
  &:hover { opacity: 0.88; }
`;

interface GroupInviteModalProps {
  groupId: string;
  isOpen: boolean;
  onClose: () => void;
  initialInvitationPayload?: string;
  title?: string;
  subtitle?: string;
  successMessage?: string;
  doneLabel?: string;
}

export default function GroupInviteModal({
  groupId,
  isOpen,
  onClose,
  initialInvitationPayload,
  title = "Invite to workspace",
  subtitle = "Share this link with anyone you want to invite.",
  doneLabel = "Done",
}: GroupInviteModalProps) {
  const [invitationPayload, setInvitationPayload] = useState(
    initialInvitationPayload ?? "",
  );
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [copiedTarget, setCopiedTarget] = useState<"web" | "desktop" | "">("");

  useEffect(() => {
    if (!isOpen) {
      setErrorMessage("");
      setCopiedTarget("");
      return;
    }

    if (initialInvitationPayload) {
      setInvitationPayload(initialInvitationPayload);
      return;
    }

    if (!groupId) {
      setInvitationPayload("");
      return;
    }

    let cancelled = false;

    const loadInvitation = async () => {
      setLoading(true);
      setErrorMessage("");

      const response = await new GroupApiDataSource().createInvitation(groupId);

      if (cancelled) return;

      if (response.error || !response.data) {
        setInvitationPayload("");
        setErrorMessage(
          response.error?.message || "Failed to generate invitation",
        );
        setLoading(false);
        return;
      }

      setInvitationPayload(
        serializeGroupInvitationPayload({
          invitation: response.data.invitation,
          groupAlias: response.data.groupAlias,
        }),
      );
      setLoading(false);
    };

    void loadInvitation();
    return () => { cancelled = true; };
  }, [groupId, initialInvitationPayload, isOpen]);

  // One shareable link: the HTTPS universal link works everywhere — it opens the
  // web/PWA app directly, and on a device with the desktop installed + associated
  // hands off to the launcher. The old calimero:// "desktop link" is redundant.
  const webUrl = useMemo(
    () => (invitationPayload ? generateInvitationUrl(invitationPayload) : ""),
    [invitationPayload],
  );

  const handleCopy = async () => {
    if (!webUrl) return;
    try {
      await navigator.clipboard.writeText(webUrl);
      setCopiedTarget("web");
      setTimeout(() => setCopiedTarget(""), 2000);
    } catch {
      prompt("Copy this invite link:", webUrl);
    }
  };

  if (!isOpen) return null;

  return (
    <Overlay onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Modal>
        <ModalHeader>
          <IconBox>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
          </IconBox>
          <HeaderText>
            <ModalTitle>{title}</ModalTitle>
            <ModalSub>{subtitle}</ModalSub>
          </HeaderText>
          <CloseBtn onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </CloseBtn>
        </ModalHeader>

        <Body>
          {loading && (
            <LoadingRow>
              <Spinner />
              Generating invitation…
            </LoadingRow>
          )}

          {!loading && errorMessage && (
            <ErrorBanner>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {errorMessage}
            </ErrorBanner>
          )}

          {!loading && invitationPayload && (
            <CopyBtn $copied={copiedTarget === "web"} onClick={() => void handleCopy()}>
              {copiedTarget === "web" ? "✓ Copied!" : "Copy invite link"}
            </CopyBtn>
          )}

          <DoneBtn onClick={onClose}>{doneLabel}</DoneBtn>
        </Body>
      </Modal>
    </Overlay>
  );
}
