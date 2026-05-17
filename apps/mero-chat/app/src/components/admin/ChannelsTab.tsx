import React, { useEffect, useState, useCallback } from "react";
import styled from "styled-components";
import type {
  ContextVisibility,
  VisibilityMode,
} from "../../api/groupApi";
import { useGroupContexts } from "../../hooks/useGroupContexts";
import type { ContextInfo } from "../../types/Common";
import { scrollbarStyles } from "../../styles/scrollbar";

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  ${scrollbarStyles}
`;

const ContextRow = styled.div<{ $expanded: boolean }>`
  border-radius: 6px;
  transition: background 0.12s ease;
  background: ${({ $expanded }) =>
    $expanded ? "rgba(255, 255, 255, 0.03)" : "transparent"};
  &:hover {
    background: rgba(255, 255, 255, 0.04);
  }
`;

const ContextHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.625rem;
  cursor: pointer;
`;

const ContextName = styled.span`
  font-size: 0.82rem;
  color: #fff;
  font-weight: 500;
`;

const ContextId = styled.span`
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.3);
  margin-left: 0.5rem;
`;

const VisibilityBadge = styled.span<{ $restricted: boolean }>`
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  background: ${({ $restricted }) =>
    $restricted ? "rgba(239, 68, 68, 0.12)" : "rgba(165, 255, 17, 0.1)"};
  color: ${({ $restricted }) =>
    $restricted ? "#f87171" : "#a5ff11"};
`;

const DetailPanel = styled.div`
  padding: 0.5rem 0.625rem 0.75rem;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
`;

const SectionLabel = styled.div`
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 0.375rem;
  margin-top: 0.5rem;
`;

const ToggleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
`;

const ToggleButton = styled.button<{ $active: boolean }>`
  background: ${({ $active }) =>
    $active ? "rgba(165, 255, 17, 0.12)" : "rgba(255, 255, 255, 0.06)"};
  border: 1px solid
    ${({ $active }) =>
      $active ? "rgba(165, 255, 17, 0.3)" : "rgba(255, 255, 255, 0.08)"};
  color: ${({ $active }) => ($active ? "#a5ff11" : "rgba(255, 255, 255, 0.5)")};
  font-size: 0.72rem;
  font-weight: 500;
  padding: 0.25rem 0.625rem;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const AllowlistContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-bottom: 0.375rem;
`;

const AllowlistChip = styled.div`
  display: flex;
  align-items: center;
  gap: 0.25rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  padding: 0.2rem 0.375rem;
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.6);
`;

const ChipRemove = styled.button`
  background: transparent;
  border: none;
  color: rgba(239, 68, 68, 0.6);
  cursor: pointer;
  font-size: 0.7rem;
  padding: 0;
  line-height: 1;
  &:hover {
    color: #f87171;
  }
`;

const InputRow = styled.div`
  display: flex;
  gap: 0.375rem;
`;

const AllowlistInput = styled.input`
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  color: #fff;
  font-size: 0.75rem;
  padding: 0.375rem 0.5rem;
  outline: none;
  &:focus {
    border-color: rgba(165, 255, 17, 0.4);
  }
`;

const SmallButton = styled.button`
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.7rem;
  padding: 0.25rem 0.5rem;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 1.5rem;
  color: rgba(255, 255, 255, 0.3);
  font-size: 0.82rem;
`;

const LoadingText = styled.div`
  color: rgba(255, 255, 255, 0.3);
  font-size: 0.75rem;
  padding: 0.5rem 0;
`;

interface ChannelDetail {
  contextId: string;
  info: ContextInfo | null;
  visibility: ContextVisibility | null;
  allowlist: string[];
}

function truncateId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}...${id.slice(-8)}`;
}

interface ChannelsTabProps {
  groupId: string;
  onGetVisibility: (
    groupId: string,
    contextId: string,
  ) => Promise<ContextVisibility | null>;
  onSetVisibility: (
    groupId: string,
    contextId: string,
    mode: VisibilityMode,
  ) => Promise<boolean>;
  onGetAllowlist: (groupId: string, contextId: string) => Promise<string[]>;
  onManageAllowlist: (
    groupId: string,
    contextId: string,
    add?: string[],
    remove?: string[],
  ) => Promise<boolean>;
  actionLoading: boolean;
}

export default function ChannelsTab({
  groupId,
  onGetVisibility,
  onSetVisibility,
  onGetAllowlist,
  onManageAllowlist,
  actionLoading,
}: ChannelsTabProps) {
  const { channels, fetchGroupContexts } = useGroupContexts();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ChannelDetail>>({});
  const [addInput, setAddInput] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (groupId) fetchGroupContexts(groupId);
  }, [groupId]);

  const loadDetails = useCallback(
    async (contextId: string) => {
      setLoading(true);
      const [vis, allowlist] = await Promise.all([
        onGetVisibility(groupId, contextId),
        onGetAllowlist(groupId, contextId),
      ]);
      const channel = channels.find((c) => c.contextId === contextId);
      setDetails((prev) => ({
        ...prev,
        [contextId]: {
          contextId,
          info: channel?.info ?? null,
          visibility: vis,
          allowlist,
        },
      }));
      setLoading(false);
    },
    [groupId, channels, onGetVisibility, onGetAllowlist],
  );

  const toggleExpand = (contextId: string) => {
    if (expandedId === contextId) {
      setExpandedId(null);
    } else {
      setExpandedId(contextId);
      if (!details[contextId]) {
        loadDetails(contextId);
      }
    }
  };

  const handleToggleVisibility = async (
    contextId: string,
    currentMode: VisibilityMode,
  ) => {
    const newMode: VisibilityMode =
      currentMode === "open" ? "restricted" : "open";
    const ok = await onSetVisibility(groupId, contextId, newMode);
    if (ok) loadDetails(contextId);
  };

  const handleAddToAllowlist = async (contextId: string) => {
    const identity = addInput.trim();
    if (!identity) return;
    const ok = await onManageAllowlist(groupId, contextId, [identity]);
    if (ok) {
      setAddInput("");
      loadDetails(contextId);
    }
  };

  const handleRemoveFromAllowlist = async (
    contextId: string,
    identity: string,
  ) => {
    const ok = await onManageAllowlist(
      groupId,
      contextId,
      undefined,
      [identity],
    );
    if (ok) loadDetails(contextId);
  };

  if (channels.length === 0) {
    return <EmptyState>No contexts in this group</EmptyState>;
  }

  return (
    <List>
      {channels.map((ch) => {
        const isExpanded = expandedId === ch.contextId;
        const detail = details[ch.contextId];
        const visMode = detail?.visibility?.mode;

        return (
          <ContextRow key={ch.contextId} $expanded={isExpanded}>
            <ContextHeader onClick={() => toggleExpand(ch.contextId)}>
              <div>
                <ContextName>
                  {ch.info?.name || "Unnamed"}
                </ContextName>
                <ContextId>{truncateId(ch.contextId)}</ContextId>
              </div>
              {visMode && (
                <VisibilityBadge $restricted={visMode === "restricted"}>
                  {visMode}
                </VisibilityBadge>
              )}
            </ContextHeader>

            {isExpanded && (
              <DetailPanel>
                {loading && !detail ? (
                  <LoadingText>Loading...</LoadingText>
                ) : detail ? (
                  <>
                    <SectionLabel>Visibility</SectionLabel>
                    <ToggleRow>
                      <ToggleButton
                        $active={visMode === "open"}
                        onClick={() =>
                          handleToggleVisibility(
                            ch.contextId,
                            visMode ?? "open",
                          )
                        }
                        disabled={actionLoading || visMode === "open"}
                      >
                        Open
                      </ToggleButton>
                      <ToggleButton
                        $active={visMode === "restricted"}
                        onClick={() =>
                          handleToggleVisibility(
                            ch.contextId,
                            visMode ?? "open",
                          )
                        }
                        disabled={actionLoading || visMode === "restricted"}
                      >
                        Restricted
                      </ToggleButton>
                    </ToggleRow>

                    {visMode === "restricted" && (
                      <>
                        <SectionLabel>
                          Allowlist ({detail.allowlist.length})
                        </SectionLabel>
                        <AllowlistContainer>
                          {detail.allowlist.map((id) => (
                            <AllowlistChip key={id}>
                              <span title={id}>{truncateId(id)}</span>
                              <ChipRemove
                                onClick={() =>
                                  handleRemoveFromAllowlist(ch.contextId, id)
                                }
                                title="Remove from allowlist"
                              >
                                x
                              </ChipRemove>
                            </AllowlistChip>
                          ))}
                          {detail.allowlist.length === 0 && (
                            <span
                              style={{
                                fontSize: "0.72rem",
                                color: "rgba(255,255,255,0.3)",
                              }}
                            >
                              No entries
                            </span>
                          )}
                        </AllowlistContainer>
                        <InputRow>
                          <AllowlistInput
                            value={addInput}
                            onChange={(e) => setAddInput(e.target.value)}
                            placeholder="Identity public key"
                            onKeyDown={(e) => {
                              if (e.key === "Enter")
                                handleAddToAllowlist(ch.contextId);
                            }}
                          />
                          <SmallButton
                            onClick={() =>
                              handleAddToAllowlist(ch.contextId)
                            }
                            disabled={actionLoading || !addInput.trim()}
                          >
                            Add
                          </SmallButton>
                        </InputRow>
                      </>
                    )}
                  </>
                ) : null}
              </DetailPanel>
            )}
          </ContextRow>
        );
      })}
    </List>
  );
}
