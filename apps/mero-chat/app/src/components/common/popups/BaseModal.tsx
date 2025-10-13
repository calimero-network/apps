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
  @media (min-width: 1025px) {
    left: 0px;
    right: 0px;
    bottom: 0px;
    top: 0px;
    position: fixed;
    width: 100%;
    height: 100%;
    z-index: 20;
    display: flex;
    background-color: rgba(0, 0, 0, 0.5);
    justify-content: center;
    align-items: center;
  }

  @media (max-width: 1024px) {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    background-color: rgba(0, 0, 0, 0.5);
    padding-top: 60px;
  }
`;

const OverlayContainerChild = styled.div`
  @media (min-width: 1025px) {
    left: 0px;
    right: 0px;
    bottom: 0px;
    top: 0px;
    position: fixed;
    width: 100%;
    height: 100%;
    z-index: 20;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: rgba(0, 0, 0, 0.5);
  }
  @media (max-width: 1024px) {
    width: 100%;
    height: 100%;
    position: fixed;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 1001;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    background-color: rgba(0, 0, 0, 0.5);
    padding-top: 60px;
  }
`;

const PopupContainer = styled.div`
  position: relative;
  background-color: #1d1d21;
  padding: 1rem;
  border-radius: 8px;
  width: 540px;
  @media (max-width: 1024px) {
    width: calc(100% - 2rem);
    max-width: calc(100vw - 2rem);
    position: relative;
    left: auto;
    top: auto;
    transform: none;
    background-color: #1d1d21;
    height: fit-content;
    box-sizing: border-box;
    margin: 1rem;
    max-height: calc(100vh - 120px);
    overflow-y: auto;
  }
  outline: none;
  &:focus {
    outline: none;
  }
  &:focus-visible {
    outline: none;
  }
`;

const PopupContainerChild = styled.div`
  @media (min-width: 1025px) {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    background-color: #1d1d21;
    padding: 1rem;
    border-radius: 8px;
    width: 540px;
    height: fit-content;
  }
  @media (max-width: 1024px) {
    position: relative;
    background-color: #1d1d21;
    padding: 1rem;
    border-radius: 8px;
    width: calc(100% - 2rem);
    max-width: calc(100vw - 2rem);
    height: fit-content;
    box-sizing: border-box;
    margin: 1rem;
    max-height: calc(100vh - 120px);
    overflow-y: auto;
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
