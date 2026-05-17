import React, { useState, useEffect, useRef } from "react";
import styled, { keyframes } from "styled-components";
import type { GroupInfo, GroupUpgradeStatus } from "../../api/groupApi";

const Section = styled.div`
  margin-bottom: 1.25rem;
`;

const SectionTitle = styled.div`
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 0.5rem;
`;

const Description = styled.div`
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.35);
  margin-bottom: 0.625rem;
  line-height: 1.4;
`;

const InputLabel = styled.label`
  display: block;
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 0.25rem;
`;

const TextInput = styled.input`
  width: 100%;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  color: #fff;
  font-size: 0.78rem;
  padding: 0.4rem 0.5rem;
  outline: none;
  margin-bottom: 0.5rem;
  &:focus {
    border-color: rgba(165, 255, 17, 0.4);
  }
`;

const TriggerButton = styled.button`
  background: rgba(124, 58, 237, 0.12);
  border: 1px solid rgba(124, 58, 237, 0.3);
  color: #a78bfa;
  font-size: 0.78rem;
  font-weight: 500;
  padding: 0.4rem 1rem;
  border-radius: 6px;
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
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.7rem;
  padding: 0.25rem 0.5rem;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
  margin-left: 0.5rem;
  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
`;

const StatusCard = styled.div`
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
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
  color: rgba(255, 255, 255, 0.4);
`;

const StatusValue = styled.span`
  font-size: 0.75rem;
  color: #fff;
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
  border-radius: 4px;
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
        return "rgba(255, 255, 255, 0.06)";
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
        return "#f87171";
      default:
        return "rgba(255, 255, 255, 0.5)";
    }
  }};
`;

const ProgressBar = styled.div`
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  margin-top: 0.5rem;
  overflow: hidden;
`;

const ProgressFill = styled.div<{ $percent: number }>`
  height: 100%;
  width: ${({ $percent }) => $percent}%;
  background: #a5ff11;
  border-radius: 2px;
  transition: width 0.3s ease;
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 1.5rem;
  color: rgba(255, 255, 255, 0.3);
  font-size: 0.82rem;
`;

const Spinner = styled.span`
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-top-color: #a78bfa;
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
    migrateMethod?: string,
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
  const [migrateMethod, setMigrateMethod] = useState("");
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
    await onTriggerUpgrade(
      groupId,
      targetAppId.trim(),
      migrateMethod.trim() || undefined,
    );
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
        <InputLabel>Migration Method (optional)</InputLabel>
        <TextInput
          value={migrateMethod}
          onChange={(e) => setMigrateMethod(e.target.value)}
          placeholder="e.g. migrate_v2"
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
