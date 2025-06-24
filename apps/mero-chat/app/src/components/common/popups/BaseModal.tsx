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

const BaseModal: React.FC<BaseModalProps> = (props) => {
  const content = props.content;
  const open = props.open;
  const onOpenChange = props.onOpenChange;
  const toggle = props.toggle;
  const isChild = props.isChild;

  const OverlayContainer = styled.div`
    @media (min-width: 1025px) {
      left: 0px;
      right: 0px;
      bottom: 0px;
      top: 0px;
      position: absolute;
      width: 100%;
      height: 100%;
      z-index: 20;
      display: flex;
      background-color: rgba(0, 0, 0, 0.5);
      justify-content: center;
      align-items: center;
    }

    @media (max-width: 1024px) {
      position: absolute;
      z-index: 20;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      height: 100vh;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      background-color: rgba(0, 0, 0, 0.5);
    }
  `;

  const OverlayContainerChild = styled.div`
    @media (min-width: 1025px) {
      left: 0px;
      right: 0px;
      bottom: 0px;
      top: 0px;
      position: absolute;
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
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      bottom: 0;
      z-index: 20;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      background-color: rgba(0, 0, 0, 0.5);
    }
  `;

  const PopupContainer = styled.div`
    position: relative;
    background-color: #1d1d21;
    padding: 1rem;
    border-radius: 8px;
    width: 489px;
    @media (max-width: 1024px) {
      width: 90%;
      position: absolute;
      left: 50%;
      top: 20%;
      transform: translate(-50%, -20%);
      background-color: #1d1d21;
      width: 100%;
      height: fit-content;
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
      width: 489px;
      height: fit-content;
    }
    @media (max-width: 1024px) {
      position: absolute;
      background-color: #1d1d21;
      padding: 1rem;
      border-radius: 8px;
      width: 100%;
      height: fit-content;
    }
  `;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>{toggle}</Dialog.Trigger>
      <Dialog.Overlay asChild>
        {isChild ? (
          <OverlayContainerChild>
            <Dialog.Content asChild>
              <PopupContainerChild>{content}</PopupContainerChild>
            </Dialog.Content>
          </OverlayContainerChild>
        ) : (
          <OverlayContainer>
            <Dialog.Content asChild>
              <PopupContainer>{content}</PopupContainer>
            </Dialog.Content>
          </OverlayContainer>
        )}
      </Dialog.Overlay>
    </Dialog.Root>
  );
};

export default BaseModal;
