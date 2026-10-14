import React, { useState, useEffect, useRef } from "react";
import styled, { keyframes } from "styled-components";
import type { GroupInfo, GroupUpgradeStatus } from "../../api/groupApi";

const Section = styled.div`
  margin-bottom: 1.25rem;
`;

const SectionTitle = styled.div`
  font-size: 0.78rem;
  font-weight: 600;
  color: color-mix(in srgb, var(--glass-ink) 70%, transparent);
  margin-bottom: 0.5rem;
`;

const Description = styled.div`
  font-size: 0.72rem;
  color: color-mix(in srgb, var(--glass-ink) 35%, transparent);
  margin-bottom: 0.625rem;
  line-height: 1.4;
`;

const InputLabel = styled.label`
  display: block;
  font-size: 0.72rem;
  color: color-mix(in srgb, var(--glass-ink) 45%, transparent);
  margin-bottom: 0.25rem;
`;

const TextInput = styled.input`
  width: 100%;
  background: color-mix(in srgb, var(--glass-ink) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--glass-ink) 10%, transparent);
  border-radius: 5px;
  color: var(--glass-ink);
  font-size: 0.78rem;
  padding: 0.4rem 0.5rem;
  outline: none;
  margin-bottom: 0.5rem;
  &:focus {
    border-color: color-mix(in srgb, var(--glass-accent) 40%, transparent);
  }
`;

const TriggerButton = styled.button`
  background: rgba(124, 58, 237, 0.12);
  border: 1px solid rgba(124, 58, 237, 0.3);
  color: #7c3aed;
  font-size: 0.78rem;
  font-weight: 500;
  padding: 0.4rem 1rem;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  &:hover {
    background: rgba(124, 58, 237, 0.2);
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const RefreshButton = styled.button`
  background: color-mix(in srgb, var(--glass-ink) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--glass-ink) 8%, transparent);
  color: color-mix(in srgb, var(--glass-ink) 60%, transparent);
  font-size: 0.7rem;
  padding: 0.25rem 0.5rem;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
  margin-left: 0.5rem;
  &:hover {
    background: color-mix(in srgb, var(--glass-ink) 10%, transparent);
    color: var(--glass-ink);
  }
`;

const StatusCard = styled.div`
  background: color-mix(in srgb, var(--glass-ink) 2%, transparent);
  border: 1px solid color-mix(in srgb, var(--glass-ink) 6%, transparent);
  border-radius: 10px;
  padding: 0.75rem;
`;

const StatusRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.375rem;
  &:last-child {
    margin-bottom: 0;
  }
`;

const StatusLabel = styled.span`
  font-size: 0.72rem;
  color: color-mix(in srgb, var(--glass-ink) 40%, transparent);
`;

const StatusValue = styled.span`
  font-size: 0.75rem;
  color: var(--glass-ink);
`;

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const StatusBadge = styled.span<{ $status: string }>`
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.125rem 0.5rem;
  border-radius: 8px;
  background: ${({ $status }) => {
    switch ($status.toLowerCase()) {
      case "completed":
        return "rgba(34, 197, 94, 0.12)";
      case "in_progress":
      case "inprogress":
        return "rgba(234, 179, 8, 0.12)";
      case "failed":
        return "rgba(239, 68, 68, 0.12)";
      default:
        return "color-mix(in srgb, var(--glass-ink) 6%, transparent)";
    }
  }};
  color: ${({ $status }) => {
    switch ($status.toLowerCase()) {
      case "completed":
        return "#4ade80";
      case "in_progress":
      case "inprogress":
        return "#facc15";
      case "failed":
        return "var(--glass-bad-ink)";
      default:
        return "color-mix(in srgb, var(--glass-ink) 50%, transparent)";
    }
  }};
`;

const ProgressBar = styled.div`
  width: 100%;
  height: 4px;
  background: color-mix(in srgb, var(--glass-ink) 6%, transparent);
  border-radius: 2px;
  margin-top: 0.5rem;
  overflow: hidden;
`;

const ProgressFill = styled.div<{ $percent: number }>`
  height: 100%;
  width: ${({ $percent }) => $percent}%;
  background: var(--glass-ink);
  border-radius: 2px;
  transition: width 0.3s ease;
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 1.5rem;
  color: color-mix(in srgb, var(--glass-ink) 30%, transparent);
  font-size: 0.82rem;
`;

const Spinner = styled.span`
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid color-mix(in srgb, var(--glass-ink) 15%, transparent);
  border-top-color: #7c3aed;
  border-radius: 50%;
  animation: ${spin} 0.6s linear infinite;
  margin-right: 0.375rem;
  vertical-align: middle;
`;

interface UpgradeTabProps {
  groupId: string;
  group: GroupInfo | null;
  upgradeStatus: GroupUpgradeStatus | null;
  actionLoading: boolean;
  onTriggerUpgrade: (
    groupId: string,
    targetApplicationId: string,
  ) => Promise<boolean>;
  onRefreshStatus: (groupId: string) => Promise<void>;
}

export default function UpgradeTab({
  groupId,
  group: _group,
  upgradeStatus,
  actionLoading,
  onTriggerUpgrade,
  onRefreshStatus,
}: UpgradeTabProps) {
  const [targetAppId, setTargetAppId] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isInProgress =
    upgradeStatus &&
    upgradeStatus.status.toLowerCase() !== "completed" &&
    upgradeStatus.status.toLowerCase() !== "failed";

  useEffect(() => {
    if (isInProgress) {
      pollRef.current = setInterval(() => {
        onRefreshStatus(groupId);
      }, 5000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isInProgress, groupId, onRefreshStatus]);

  const handleTrigger = async () => {
    if (!targetAppId.trim()) return;
    await onTriggerUpgrade(groupId, targetAppId.trim());
  };

  const progressPercent =
    upgradeStatus?.total && upgradeStatus.completed != null
      ? Math.round((upgradeStatus.completed / upgradeStatus.total) * 100)
      : 0;

  return (
    <>
      {upgradeStatus ? (
        <Section>
          <SectionTitle>
            Active Upgrade
            <RefreshButton onClick={() => onRefreshStatus(groupId)}>
              Refresh
            </RefreshButton>
          </SectionTitle>
          <StatusCard>
            <StatusRow>
              <StatusLabel>Status</StatusLabel>
              <StatusBadge $status={upgradeStatus.status}>
                {isInProgress && <Spinner />}
                {upgradeStatus.status}
              </StatusBadge>
            </StatusRow>
            <StatusRow>
              <StatusLabel>From</StatusLabel>
              <StatusValue style={{ fontSize: "0.68rem", wordBreak: "break-all" }}>
                {upgradeStatus.fromVersion}
              </StatusValue>
            </StatusRow>
            <StatusRow>
              <StatusLabel>To</StatusLabel>
              <StatusValue style={{ fontSize: "0.68rem", wordBreak: "break-all" }}>
                {upgradeStatus.toVersion}
              </StatusValue>
            </StatusRow>
            <StatusRow>
              <StatusLabel>Progress</StatusLabel>
              <StatusValue>
                {upgradeStatus.completed ?? 0} / {upgradeStatus.total ?? "?"}{" "}
                {upgradeStatus.failed ? `(${upgradeStatus.failed} failed)` : ""}
              </StatusValue>
            </StatusRow>
            {upgradeStatus.total != null && (
              <ProgressBar>
                <ProgressFill $percent={progressPercent} />
              </ProgressBar>
            )}
            {upgradeStatus.completedAt && (
              <StatusRow style={{ marginTop: "0.375rem" }}>
                <StatusLabel>Completed at</StatusLabel>
                <StatusValue>
                  {new Date(upgradeStatus.completedAt).toLocaleString()}
                </StatusValue>
              </StatusRow>
            )}
            <StatusRow style={{ marginTop: "0.375rem" }}>
              <StatusLabel>Initiated by</StatusLabel>
              <StatusValue style={{ fontSize: "0.68rem" }}>
                {upgradeStatus.initiatedBy.length > 16
                  ? `${upgradeStatus.initiatedBy.slice(0, 8)}...${upgradeStatus.initiatedBy.slice(-8)}`
                  : upgradeStatus.initiatedBy}
              </StatusValue>
            </StatusRow>
          </StatusCard>
        </Section>
      ) : (
        <Section>
          <EmptyState>No active upgrade</EmptyState>
        </Section>
      )}

      <Section>
        <SectionTitle>Trigger Upgrade</SectionTitle>
        <Description>
          Upgrade all contexts in this group to a new application version.
          Existing contexts will be migrated.
        </Description>
        <InputLabel>Target Application ID</InputLabel>
        <TextInput
          value={targetAppId}
          onChange={(e) => setTargetAppId(e.target.value)}
          placeholder="New application ID (base58)"
        />
        <TriggerButton
          onClick={handleTrigger}
          disabled={actionLoading || !targetAppId.trim()}
        >
          {actionLoading ? "Upgrading..." : "Trigger Upgrade"}
        </TriggerButton>
      </Section>
    </>
  );
}
