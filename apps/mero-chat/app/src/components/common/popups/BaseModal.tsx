import React from "react";
import styled from "styled-components";
import * as Dialog from "@radix-ui/react-dialog";

interface BaseModalProps {
  content: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toggle: React.ReactNode;
  isChild?: boolean;
}

// Visually hidden component for accessibility
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

const OverlayContainer = styled.div`
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: rgba(0, 0, 0, 0.5);
`;

const OverlayContainerChild = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1001;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: rgba(0, 0, 0, 0.5);
`;

const PopupContainer = styled.div`
  position: relative;
  background-color: #1d1d21;
  padding: 1rem;
  border-radius: 8px;
  width: 540px;
  max-width: calc(100vw - 2rem);
  height: fit-content;
  max-height: calc(100vh - 2rem);
  overflow-y: auto;
  box-sizing: border-box;
  outline: none;
  &:focus {
    outline: none;
  }
  &:focus-visible {
    outline: none;
  }
`;

const PopupContainerChild = styled.div`
  position: relative;
  background-color: #1d1d21;
  padding: 1rem;
  border-radius: 8px;
  width: 540px;
  max-width: calc(100vw - 2rem);
  height: fit-content;
  max-height: calc(100vh - 2rem);
  overflow-y: auto;
  box-sizing: border-box;
  outline: none;
  &:focus {
    outline: none;
  }
  &:focus-visible {
    outline: none;
  }
`;

const BaseModal: React.FC<BaseModalProps> = (props) => {
  const content = props.content;
  const open = props.open;
  const onOpenChange = props.onOpenChange;
  const toggle = props.toggle;
  const isChild = props.isChild;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{toggle}</Dialog.Trigger>
      <Dialog.Overlay asChild>
        {isChild ? (
          <OverlayContainerChild>
            <Dialog.Content asChild>
              <PopupContainerChild>
                <Dialog.Title asChild>
                  <VisuallyHidden>Dialog</VisuallyHidden>
                </Dialog.Title>
                <Dialog.Description asChild>
                  <VisuallyHidden>Dialog content</VisuallyHidden>
                </Dialog.Description>
                {content}
              </PopupContainerChild>
            </Dialog.Content>
          </OverlayContainerChild>
        ) : (
          <OverlayContainer>
            <Dialog.Content asChild>
              <PopupContainer>
                <Dialog.Title asChild>
                  <VisuallyHidden>Dialog</VisuallyHidden>
                </Dialog.Title>
                <Dialog.Description asChild>
                  <VisuallyHidden>Dialog content</VisuallyHidden>
                </Dialog.Description>
                {content}
              </PopupContainer>
            </Dialog.Content>
          </OverlayContainer>
        )}
      </Dialog.Overlay>
    </Dialog.Root>
  );
};

export default BaseModal;
