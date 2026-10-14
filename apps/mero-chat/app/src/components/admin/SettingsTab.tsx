import React from "react";
import styled from "styled-components";
import type { GroupInfo, GroupMember, VisibilityMode } from "../../api/groupApi";

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

const TeeCard = styled.div`
  display: grid;
  gap: 0.5rem;
  border: 1px solid color-mix(in srgb, var(--glass-ink) 9%, transparent);
  border-radius: 10px;
  padding: 0.625rem 0.75rem;
`;

const TeeHeader = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--glass-ink);
`;

const Pill = styled.span<{ $tone: "good" | "accent" }>`
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 600;
  color: ${({ $tone }) => ($tone === "good" ? "var(--glass-good-ink)" : "var(--glass-accent)")};
  background: ${({ $tone }) =>
    $tone === "good"
      ? "color-mix(in srgb, var(--glass-good-ink) 12%, transparent)"
      : "color-mix(in srgb, var(--glass-accent) 10%, transparent)"};
`;

const TeeText = styled.p`
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.45;
  color: color-mix(in srgb, var(--glass-ink) 60%, transparent);
`;

const NodeIds = styled.span`
  display: grid;
  gap: 0.125rem;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 0.72rem;
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
  /** TEE nodes admitted to the namespace; never part of the member list. */
  teeMembers?: GroupMember[];
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
  teeMembers = [],
  actionLoading: _actionLoading,
  onSetDefaultCapabilities: _onSetDefaultCapabilities,
  onSetSubgroupVisibility: _onSetSubgroupVisibility,
}: SettingsTabProps) {
  if (!group) {
    return <EmptyState>No group data available</EmptyState>;
  }

  // core's `memberCount` counts every member row, TEE nodes included. The
  // Members tab lists people only, so this count must agree with it.
  const peopleCount = Math.max(0, group.memberCount - teeMembers.length);

  return (
    <>
      <ConfidentialCompute teeMembers={teeMembers} />

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
          <Value>{peopleCount}</Value>
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

const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);

/**
 * Whether a TEE node backs this namespace. The node is admitted by hardware
 * attestation as a `ReadOnlyTee` (replica) or `RelayTee` (relay) member; it is
 * infrastructure, so it is shown here instead of in the member list.
 */
function ConfidentialCompute({ teeMembers }: { teeMembers: GroupMember[] }) {
  if (teeMembers.length === 0) {
    return (
      <Section>
        <SectionTitle>Confidential compute</SectionTitle>
        <TeeText>TEE not enabled for this workspace.</TeeText>
      </Section>
    );
  }

  const isRelay = teeMembers.some((m) => m.role === "RelayTee");

  return (
    <Section>
      <SectionTitle>Confidential compute</SectionTitle>
      <TeeCard data-testid="tee-section">
        <TeeHeader>
          TEE enabled
          <Pill $tone="good">Active</Pill>
          <Pill $tone="accent">{isRelay ? "Relay" : "Replica"}</Pill>
        </TeeHeader>
        <TeeText>
          A hardware-attested node keeps this workspace in sync and available
          when members are offline.
          {isRelay
            ? " In Relay mode it can also post a member's message when that member signs for it."
            : " It never writes on anyone's behalf."}
        </TeeText>
        <InfoGrid>
          <Label>Nodes</Label>
          <Value>{teeMembers.length}</Value>
          <Label>Node ID{teeMembers.length > 1 ? "s" : ""}</Label>
          <NodeIds>
            {teeMembers.map((m) => (
              <span key={m.identity} title={m.identity}>
                {shortId(m.identity)}
              </span>
            ))}
          </NodeIds>
        </InfoGrid>
      </TeeCard>
    </Section>
  );
}
