import React from "react";
import { styled, keyframes } from "styled-components";
import BaseModal from "../common/popups/BaseModal";
import TabbedInterface from "../contextOperations/TabbedInterface";
import { useCalimero } from "@calimero-network/calimero-client";
import {
  clearDmContextId,
  clearStoredSession,
  clearSessionActivity,
} from "../../utils/session";

// ─── Animations ────────────────────────────────────────────────────────────────

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`;

// ─── Layout ────────────────────────────────────────────────────────────────────

const Container = styled.div`
  position: relative;
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
  animation: ${fadeIn} 0.2s ease both;

  @media (max-width: 1024px) {
    max-height: calc(100vh - 140px);
  }
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.25rem;
  padding-bottom: 0.875rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
`;

const TitleGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 0.625rem;
`;

const TitleIcon = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: rgba(165, 255, 17, 0.1);
  border: 1px solid rgba(165, 255, 17, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;

  svg {
    stroke: #a5ff11;
  }
`;

const Title = styled.h2`
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  letter-spacing: 0.01em;
`;

const CloseButton = styled.button`
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.3);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s ease;

  &:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }
`;

const LogoutSection = styled.div`
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const LogoutLabel = styled.span`
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.3);
  font-weight: 500;
`;

const LogoutButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.4rem 0.875rem;
  border-radius: 7px;
  border: 1px solid rgba(255, 80, 80, 0.25);
  background: rgba(255, 80, 80, 0.06);
  color: rgba(255, 100, 100, 0.8);
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    border-color: rgba(255, 80, 80, 0.5);
    background: rgba(255, 80, 80, 0.12);
    color: #ff6464;
  }

  svg {
    opacity: 0.7;
  }
`;

// ─── Component ─────────────────────────────────────────────────────────────────

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
  const isOwner = sessionStorage.getItem("curb_is_context_owner") === "true";

  const handleLogout = () => {
    clearStoredSession();
    clearDmContextId();
    clearSessionActivity();
    logout();
    setIsOpen(false);
  };

  const tabs = isOwner
    ? [{ id: "invite-to-context", label: "Invite to Context" }]
    : [];

  const popupContent = (
    <Container>
      <Header>
        <TitleGroup>
          <TitleIcon>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </TitleIcon>
          <Title>Settings</Title>
        </TitleGroup>
        <CloseButton onClick={() => setIsOpen(false)} aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </CloseButton>
      </Header>

      {tabs.length > 0 && <TabbedInterface tabs={tabs} />}

      <LogoutSection>
        <LogoutLabel>Session</LogoutLabel>
        <LogoutButton onClick={handleLogout}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Logout
        </LogoutButton>
      </LogoutSection>
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
