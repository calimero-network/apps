import React from "react";
import styled, { css, keyframes } from "styled-components";
import * as Dialog from "@radix-ui/react-dialog";

interface BaseModalProps {
  content: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toggle: React.ReactNode;
  isChild?: boolean;
}

const VisuallyHidden = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`;

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  justify-content: center;
  align-items: center;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(10px);
`;

const OverlayChild = styled(Overlay)`
  z-index: 1001;
`;

const sharedContainer = css`
  position: relative;
  background: #111113;
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 1.75rem;
  border-radius: 16px;
  width: 480px;
  max-width: calc(100vw - 2rem);
  height: fit-content;
  max-height: calc(100vh - 2rem);
  overflow-y: auto;
  box-sizing: border-box;
  box-shadow: 0 32px 64px rgba(0, 0, 0, 0.7);
  animation: ${fadeIn} 0.2s ease both;
  outline: none;
  &:focus, &:focus-visible { outline: none; }
`;

const PopupContainer = styled.div`${sharedContainer}`;
const PopupContainerChild = styled.div`${sharedContainer}`;

const BaseModal: React.FC<BaseModalProps> = ({
  content,
  open,
  onOpenChange,
  toggle,
  isChild,
}) => (
  <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Trigger asChild>{toggle}</Dialog.Trigger>
    <Dialog.Overlay asChild>
      {isChild ? (
        <OverlayChild>
          <Dialog.Content asChild>
            <PopupContainerChild>
              <Dialog.Title asChild><VisuallyHidden>Dialog</VisuallyHidden></Dialog.Title>
              <Dialog.Description asChild><VisuallyHidden>Dialog content</VisuallyHidden></Dialog.Description>
              {content}
            </PopupContainerChild>
          </Dialog.Content>
        </OverlayChild>
      ) : (
        <Overlay>
          <Dialog.Content asChild>
            <PopupContainer>
              <Dialog.Title asChild><VisuallyHidden>Dialog</VisuallyHidden></Dialog.Title>
              <Dialog.Description asChild><VisuallyHidden>Dialog content</VisuallyHidden></Dialog.Description>
              {content}
            </PopupContainer>
          </Dialog.Content>
        </Overlay>
      )}
    </Dialog.Overlay>
  </Dialog.Root>
);

export default BaseModal;
