import React, { useEffect, useState, useCallback } from "react";
import styled, { keyframes, css } from "styled-components";
import BaseModal from "../common/popups/BaseModal";
import { useGroupAdmin } from "../../hooks/useGroupAdmin";
import { getGroupId } from "../../constants/config";
import { useCurrentGroupPermissions } from "../../hooks/useCurrentGroupPermissions";
import { scrollbarStyles } from "../../styles/scrollbar";
import MembersTab from "./MembersTab";
import SettingsTab from "./SettingsTab";

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const Container = styled.div`
  position: relative;
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
  animation: ${fadeIn} 0.2s ease both;
  ${scrollbarStyles}

  @media (max-width: 1024px) {
    max-height: calc(100vh - 140px);
  }
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
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
  background: rgba(124, 58, 237, 0.12);
  border: 1px solid rgba(124, 58, 237, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  svg {
    fill: #7c3aed;
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

const TabBar = styled.div`
  display: flex;
  gap: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  margin-bottom: 1rem;
`;

const Tab = styled.button<{ $active: boolean }>`
  background: transparent;
  border: none;
  padding: 0.5rem 0.875rem;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  border-bottom: 2px solid transparent;
  color: rgba(255, 255, 255, 0.45);

  ${({ $active }) =>
    $active &&
    css`
      color: #a5ff11;
      border-bottom-color: #a5ff11;
    `}

  &:hover {
    color: rgba(255, 255, 255, 0.8);
  }
`;

const ErrorBanner = styled.div`
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.78rem;
  color: #f87171;
`;

const DismissButton = styled.button`
  background: transparent;
  border: none;
  color: #f87171;
  cursor: pointer;
  font-size: 0.75rem;
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  &:hover {
    background: rgba(239, 68, 68, 0.15);
  }
`;

const LoadingContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: rgba(255, 255, 255, 0.4);
  font-size: 0.85rem;
`;

type AdminTab = "members" | "settings";

interface AdminPanelProps {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  toggle: React.ReactNode;
}

export default function AdminPanel({
  isOpen,
  setIsOpen,
  toggle,
}: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>("members");
  const admin = useGroupAdmin();
  const groupId = getGroupId();
  const permissions = useCurrentGroupPermissions(groupId);
  const { fetchAll } = admin;

  useEffect(() => {
    if (isOpen && groupId) {
      fetchAll(groupId);
    }
  }, [fetchAll, groupId, isOpen]);

  const handleRefresh = useCallback(() => {
    if (groupId) fetchAll(groupId);
  }, [fetchAll, groupId]);

  if (!groupId || permissions.loading || !permissions.isAdmin) {
    return null;
  }

  const tabs: { id: AdminTab; label: string }[] = [
    { id: "members", label: `Members${admin.members.length ? ` (${admin.members.length})` : ""}` },
    { id: "settings", label: "Details" },
  ];

  const content = (
    <Container>
      <Header>
        <TitleGroup>
          <TitleIcon>
            <svg width="13" height="13" viewBox="0 0 24 24">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </TitleIcon>
          <Title>Workspace Admin</Title>
        </TitleGroup>
        <CloseButton onClick={() => setIsOpen(false)} aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </CloseButton>
      </Header>

      {admin.error && (
        <ErrorBanner>
          <span>{admin.error}</span>
          <DismissButton onClick={admin.clearError}>Dismiss</DismissButton>
        </ErrorBanner>
      )}

      <TabBar>
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            $active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </Tab>
        ))}
      </TabBar>

      {admin.loading ? (
        <LoadingContainer>Loading...</LoadingContainer>
      ) : (
        <>
          {activeTab === "members" && (
            <MembersTab
              groupId={groupId}
              members={admin.members}
              actionLoading={admin.actionLoading}
              onRemoveMember={admin.removeMember}
              onSetCapabilities={admin.setMemberCapabilities}
              onGetCapabilities={admin.getMemberCapabilities}
              onRefresh={handleRefresh}
            />
          )}
          {activeTab === "settings" && (
            <SettingsTab
              groupId={groupId}
              group={admin.group}
              subgroupCount={admin.subgroupCount}
              actionLoading={admin.actionLoading}
              onSetDefaultCapabilities={admin.setDefaultCapabilities}
              onSetSubgroupVisibility={admin.setSubgroupVisibility}
            />
          )}
        </>
      )}
    </Container>
  );

  return (
    <BaseModal
      toggle={toggle}
      content={content}
      open={isOpen}
      onOpenChange={setIsOpen}
    />
  );
}
