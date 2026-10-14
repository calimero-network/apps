import React from "react";
import styled from "styled-components";
import type { GroupInfo, VisibilityMode } from "../../api/groupApi";

const Section = styled.div`
  margin-bottom: 1.25rem;
`;

const SectionTitle = styled.div`
  font-size: 0.78rem;
  font-weight: 600;
  color: color-mix(in srgb, var(--glass-ink) 70%, transparent);
  margin-bottom: 0.5rem;
`;

const Label = styled.span`
  font-size: 0.75rem;
  color: color-mix(in srgb, var(--glass-ink) 50%, transparent);
  min-width: 120px;
`;

const Value = styled.span`
  font-size: 0.78rem;
  color: var(--glass-ink);
`;

const InfoGrid = styled.div`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.375rem 0.75rem;
  background: color-mix(in srgb, var(--glass-ink) 2%, transparent);
  border: 1px solid color-mix(in srgb, var(--glass-ink) 5%, transparent);
  border-radius: 10px;
  padding: 0.625rem;
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 1.5rem;
  color: color-mix(in srgb, var(--glass-ink) 30%, transparent);
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
