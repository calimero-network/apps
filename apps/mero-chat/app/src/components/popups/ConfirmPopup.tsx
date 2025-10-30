import { useState } from "react";
import { styled } from "styled-components";
import BaseModal from "../common/popups/BaseModal";
import { Button } from "@calimero-network/mero-ui";

const Container = styled.div`
  position: relative;
  background-color: #1d1d21;
  padding: 0.75rem 0.75rem 0.75rem 0.75rem;
  border-radius: 6px;
  width: 100%;
  height: 100%;
`;

const Title = styled.div`
  color: #fff;
  font-family: Helvetica Neue;
  font-size: 16px;
  font-style: normal;
  font-weight: 600;
  line-height: 120%;
  margin-bottom: 0.5rem;
`;

const Message = styled.div`
  color: #c9c9cf;
  font-family: Helvetica Neue;
  font-size: 14px;
  line-height: 140%;
  margin-bottom: 0.75rem;
`;

const Actions = styled.div`
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
`;

const CloseButton = styled.div`
  color: #fff;
  :hover {
    color: #5765f2;
  }
  position: absolute;
  right: 1rem;
  cursor: pointer;
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

  const handleClose = () => {
    if (isProcessing) return;
    setIsOpen(false);
    onCancel?.();
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) return;
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
    <Container style={{ pointerEvents: "auto" }}>
      <CloseButton onClick={handleClose}>
        <i className="bi bi-x-lg"></i>
      </CloseButton>
      <Title>{title}</Title>
      <Message>{message}</Message>
      <Actions>
        <Button
          onClick={runConfirm}
          style={{ backgroundColor: "#ef4444", border: "1px solid #b91c1c", color: "#0E0E10" }}
        >
          {isProcessing ? "..." : confirmLabel}
        </Button>
        <Button onClick={handleClose} style={{ backgroundColor: "#2a2a2e", color: "#fff" }}>
          {cancelLabel}
        </Button>
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
