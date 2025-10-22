import React, { useState } from "react";
import { styled } from "styled-components";
import BaseModal from "../common/popups/BaseModal";
import TabbedInterface from "../contextOperations/TabbedInterface";
import { useCalimero } from "@calimero-network/calimero-client";
import {
  clearDmContextId,
  clearStoredSession,
  clearSessionActivity,
} from "../../utils/session";
import { Button } from "@calimero-network/mero-ui";

const Container = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  max-height: 80vh;
  overflow-y: auto;

  @media (max-width: 1024px) {
    max-height: calc(100vh - 140px);
    overflow-y: auto;
  }
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
`;

const Title = styled.h2`
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  margin: 0;
`;

const CloseButton = styled.button`
  background: transparent;
  border: none;
  color: #777583;
  font-size: 16px;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
  transition: all 0.2s ease;

  &:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
  }
`;

const LogoutWrapper = styled.div`
  display: flex;
  justify-content: center;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
`;

interface SettingsPopupProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  toggle: React.ReactNode;
}

export default function SettingsPopup({
  isOpen,
  setIsOpen,
  toggle,
}: SettingsPopupProps) {
  const { logout } = useCalimero();

  const handleLogout = () => {
    clearStoredSession();
    clearDmContextId();
    clearSessionActivity();
    logout();
    setIsOpen(false);
  };

  const tabs = [
    { id: "context-switcher", label: "Switch Context" },
    { id: "join-context", label: "Join Context" },
    { id: "invite-to-context", label: "Invite to Context" },
    { id: "create-identity", label: "Create Identity" },
    { id: "notification-settings", label: "Notification Settings" },
  ];

  const popupContent = (
    <Container>
      <Header>
        <Title>Settings</Title>
        <CloseButton onClick={() => setIsOpen(false)}>
          <i className="bi bi-x-lg"></i>
        </CloseButton>
      </Header>

      <TabbedInterface tabs={tabs} />

      <LogoutWrapper>
        <Button
          onClick={handleLogout}
          variant="secondary"
          style={{ width: "80px" }}
        >
          Logout
        </Button>
      </LogoutWrapper>
    </Container>
  );

  return (
    <BaseModal
      toggle={toggle}
      content={popupContent}
      open={isOpen}
      onOpenChange={setIsOpen}
    />
  );
}
