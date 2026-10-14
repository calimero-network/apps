import { useState } from "react";
import { styled } from "styled-components";
import BaseModal from "../common/popups/BaseModal";

const Container = styled.div`
  position: relative;
  padding: 0.125rem 0;
  min-width: 280px;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid color-mix(in srgb, var(--glass-ink) 7%, transparent);
`;

const Title = styled.div`
  color: var(--glass-ink);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
`;

const CloseButton = styled.button`
  background: transparent;
  border: none;
  color: color-mix(in srgb, var(--glass-ink) 30%, transparent);
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 10px;
  transition: all 0.15s ease;
  flex-shrink: 0;
  padding: 0;

  &:hover {
    color: var(--glass-ink);
    background: color-mix(in srgb, var(--glass-ink) 8%, transparent);
  }
`;

const Message = styled.div`
  color: color-mix(in srgb, var(--glass-ink) 60%, transparent);
  font-size: 0.82rem;
  line-height: 1.5;
  margin-bottom: 1.25rem;
`;

const Actions = styled.div`
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
`;

const ActionButton = styled.button<{ $danger?: boolean }>`
  padding: 0.45rem 1rem;
  border-radius: 10px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;

  ${({ $danger }) =>
    $danger
      ? `
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: var(--glass-bad-ink);
    &:hover { background: rgba(239, 68, 68, 0.2); border-color: rgba(239, 68, 68, 0.5); }
  `
      : `
    background: color-mix(in srgb, var(--glass-ink) 6%, transparent);
    border: 1px solid color-mix(in srgb, var(--glass-ink) 10%, transparent);
    color: color-mix(in srgb, var(--glass-ink) 70%, transparent);
    &:hover { background: color-mix(in srgb, var(--glass-ink) 10%, transparent); color: var(--glass-ink); }
  `}

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

interface ConfirmPopupProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => Promise<void> | void;
  onCancel?: () => void;
  toggle: React.ReactNode;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  isChild?: boolean;
}

export default function ConfirmPopup({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  toggle,
  isOpen,
  setIsOpen,
  isChild,
}: ConfirmPopupProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleClose = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (isProcessing) return;
    setIsOpen(false);
    onCancel?.();
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      handleClose();
      return;
    }
    setIsOpen(open);
  };

  const runConfirm = async () => {
    try {
      setIsProcessing(true);
      await onConfirm();
    } finally {
      setIsProcessing(false);
      setIsOpen(false);
    }
  };

  const content = (
    <Container>
      <Header>
        <Title>{title}</Title>
        <CloseButton onClick={(e) => handleClose(e)} aria-label="Close">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </CloseButton>
      </Header>
      <Message>{message}</Message>
      <Actions>
        <ActionButton onClick={(e) => handleClose(e)} disabled={isProcessing}>
          {cancelLabel}
        </ActionButton>
        <ActionButton $danger onClick={() => void runConfirm()} disabled={isProcessing}>
          {isProcessing ? "..." : confirmLabel}
        </ActionButton>
      </Actions>
    </Container>
  );

  return (
    <BaseModal
      toggle={toggle}
      content={content}
      open={isOpen}
      onOpenChange={handleOpenChange}
      isChild={isChild}
    />
  );
}
