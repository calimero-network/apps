import React from "react";
import styled from "styled-components";
import type { GroupInfo, VisibilityMode } from "../../api/groupApi";

const Section = styled.div`
  margin-bottom: 1.25rem;
`;

const SectionTitle = styled.div`
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 0.5rem;
`;

const Label = styled.span`
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
  min-width: 120px;
`;

const Value = styled.span`
  font-size: 0.78rem;
  color: #fff;
`;

const InfoGrid = styled.div`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.375rem 0.75rem;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 0.625rem;
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 1.5rem;
  color: rgba(255, 255, 255, 0.3);
  font-size: 0.82rem;
`;

interface SettingsTabProps {
  groupId: string;
  group: GroupInfo | null;
  subgroupCount: number | null;
  actionLoading: boolean;
  onSetDefaultCapabilities: (
    groupId: string,
    capabilities: number,
  ) => Promise<boolean>;
  onSetSubgroupVisibility: (
    groupId: string,
    mode: VisibilityMode,
  ) => Promise<boolean>;
}

export default function SettingsTab({
  groupId: _groupId,
  group,
  subgroupCount,
  actionLoading: _actionLoading,
  onSetDefaultCapabilities: _onSetDefaultCapabilities,
  onSetSubgroupVisibility: _onSetSubgroupVisibility,
}: SettingsTabProps) {
  if (!group) {
    return <EmptyState>No group data available</EmptyState>;
  }

  return (
    <>
      <Section>
        <SectionTitle>Group Info</SectionTitle>
        <InfoGrid>
          <Label>Group ID</Label>
          <Value style={{ fontSize: "0.72rem", wordBreak: "break-all" }}>
            {group.groupId}
          </Value>
          <Label>Application</Label>
          <Value style={{ fontSize: "0.72rem", wordBreak: "break-all" }}>
            {group.targetApplicationId}
          </Value>
          <Label>Members</Label>
          <Value>{group.memberCount}</Value>
          {/* 1-group-per-context model: contexts live inside subgroups, not on
              the namespace root, so the root's contextCount is always 0 / not
              meaningful. Show the subgroup count (channels + DMs) instead. */}
          <Label>Subgroups</Label>
          <Value>{subgroupCount ?? "—"}</Value>
          <Label>Upgrade Policy</Label>
          <Value>
            {typeof group.upgradePolicy === "string"
              ? group.upgradePolicy
              : "Coordinated"}
          </Value>
        </InfoGrid>
      </Section>

    </>
  );
}
