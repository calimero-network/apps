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
  border-bottom: 1px solid color-mix(in srgb, var(--glass-ink) 7%, transparent);
`;

const TitleGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 0.625rem;
`;

const TitleIcon = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 10px;
  background: var(--chat-violet-soft);
  border: 1px solid rgba(124, 58, 237, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  svg {
    fill: var(--chat-violet);
  }
`;

const Title = styled.h2`
  color: var(--glass-ink);
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  letter-spacing: 0.01em;
`;

const CloseButton = styled.button`
  background: transparent;
  border: none;
  color: color-mix(in srgb, var(--glass-ink) 30%, transparent);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 10px;
  transition: all 0.15s ease;
  &:hover {
    color: var(--glass-ink);
    background: color-mix(in srgb, var(--glass-ink) 8%, transparent);
  }
`;

const TabBar = styled.div`
  display: flex;
  gap: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--glass-ink) 7%, transparent);
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
  color: color-mix(in srgb, var(--glass-ink) 45%, transparent);

  ${({ $active }) =>
    $active &&
    css`
      color: var(--glass-accent);
      border-bottom-color: var(--glass-accent);
    `}

  &:hover {
    color: color-mix(in srgb, var(--glass-ink) 80%, transparent);
  }
`;

const ErrorBanner = styled.div`
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 10px;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.78rem;
  color: var(--glass-bad-ink);
`;

const DismissButton = styled.button`
  background: transparent;
  border: none;
  color: var(--glass-bad-ink);
  cursor: pointer;
  font-size: 0.75rem;
  padding: 0.125rem 0.375rem;
  border-radius: 8px;
  &:hover {
    background: rgba(239, 68, 68, 0.15);
  }
`;

const LoadingContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: color-mix(in srgb, var(--glass-ink) 40%, transparent);
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
              teeMembers={admin.teeMembers}
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
