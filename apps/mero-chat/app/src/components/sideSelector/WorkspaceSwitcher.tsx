import { useState, useEffect, useRef, useCallback } from "react";
import styled from "styled-components";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import { useWorkspaceName } from "../../hooks/useWorkspaceName";
import {
  resolveWorkspaceName,
  shouldBackfillWorkspaceName,
} from "../../utils/workspaceName";
import type { GroupSummary } from "../../api/groupApi";
import { getGroupId, setGroupId, getStoredGroupAlias } from "../../constants/config";
import { clearStoredSession } from "../../utils/session";

interface WorkspaceSwitcherProps {
  isCollapsed: boolean;
}

const Trigger = styled.button<{ $isCollapsed: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  width: ${({ $isCollapsed }) => ($isCollapsed ? "36px" : "calc(100% - 1.5rem)")};
  margin: 0 ${({ $isCollapsed }) => ($isCollapsed ? "12px" : "0.75rem")} 0.25rem;
  padding: ${({ $isCollapsed }) => ($isCollapsed ? "0.4rem" : "0.4rem 0.75rem")};
  justify-content: ${({ $isCollapsed }) => ($isCollapsed ? "center" : "flex-start")};
  background: transparent;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  color: #c8c7d1;
  transition: background 0.15s ease, color 0.15s ease;
  min-width: 0;

  &:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
  }
`;

const WorkspaceIcon = styled.div`
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: inherit;
`;

const WorkspaceName = styled.span`
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  text-align: left;
`;

const ChevronIcon = styled.div<{ $open: boolean }>`
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.4);
  transform: ${({ $open }) => ($open ? "rotate(180deg)" : "rotate(0deg)")};
  transition: transform 0.2s ease;
  display: flex;
  align-items: center;
`;

const DropdownWrapper = styled.div`
  position: relative;
`;

const Dropdown = styled.div<{ $isCollapsed: boolean }>`
  position: absolute;
  top: calc(100% + 4px);
  ${({ $isCollapsed }) => ($isCollapsed ? "left: 48px; top: 0;" : "left: 0.75rem; right: 0.75rem;")}
  background: #18181c;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 9px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
  z-index: 200;
  overflow: hidden;
  min-width: 160px;
`;

const DropdownItem = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: ${({ $active }) => ($active ? "rgba(165,255,17,0.08)" : "transparent")};
  border: none;
  cursor: pointer;
  color: ${({ $active }) => ($active ? "#a5ff11" : "#c8c7d1")};
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  transition: background 0.12s ease, color 0.12s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #fff;
  }
`;

const ActiveDot = styled.div`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #a5ff11;
  flex-shrink: 0;
`;

const EmptyDot = styled.div`
  width: 6px;
  height: 6px;
  flex-shrink: 0;
`;

const DropdownLabel = styled.div`
  padding: 0.4rem 0.75rem 0.25rem;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.25);
`;

export default function WorkspaceSwitcher({ isCollapsed }: WorkspaceSwitcherProps) {
  const [workspaces, setWorkspaces] = useState<GroupSummary[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const currentGroupId = getGroupId();
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const api = new GroupApiDataSource();
    void api.listGroups().then(async (resp) => {
      if (!resp.data) return;

      // Read the replicated name per workspace. The listing does not carry
      // metadata, so this is one call each — a handful, and only on open.
      // Failures are silent: a workspace whose metadata cannot be read still
      // shows its local alias rather than disappearing.
      const named = await Promise.all(
        resp.data.map(async (w) => {
          const localAlias = getStoredGroupAlias(w.groupId);
          const record = await api.getGroupMetadata(w.groupId).catch(() => null);
          const sources = {
            metadataName: record?.data?.name,
            serverAlias: w.alias,
            localAlias,
            groupId: w.groupId,
          };

          // Promote a name this browser knows and the workspace does not, so a
          // workspace named before metadata was used becomes visible to
          // everyone. Best-effort — a member without CAN_MANAGE_METADATA is
          // refused, and the local alias keeps showing for them.
          if (shouldBackfillWorkspaceName(sources)) {
            void api.setGroupMetadata(w.groupId, localAlias).catch(() => {});
          }

          return { ...w, alias: resolveWorkspaceName(sources) };
        }),
      );

      setWorkspaces(named);
    });
  }, []);

  const current = workspaces.find((w) => w.groupId === currentGroupId);

  // The pill's own name comes from the shared hook when the listing cannot
  // supply it.
  //
  // The listing can be empty — a node that cannot resolve the application id
  // returns nothing — and keying the displayed name off `find(...)` is what
  // showed a truncated id here while Settings showed the name. The hook needs
  // only the current group id, which is always known.
  const currentName = useWorkspaceName(currentGroupId);
  // The listing's entry already ranks metadata above the server alias above the
  // local one, so prefer it when the workspace is in the list. The hook is the
  // fallback for when it is NOT — an empty listing is exactly the case that
  // showed a truncated id here while Settings showed the name.
  const displayName = current?.alias || (currentGroupId ? currentName : "Workspace");

  const handleSelect = useCallback((groupId: string) => {
    if (groupId === currentGroupId) { setIsOpen(false); return; }
    setGroupId(groupId);
    // The stored session chat belongs to the workspace we're leaving. Home
    // restores it verbatim on mount — subscribing SSE to its contextId and
    // selecting it — and ActiveChat carries no group id, so nothing
    // downstream can tell it is stale. Carrying it across a switch lands the
    // user on a channel from the old workspace, on a context the new one
    // doesn't have. NamespaceEntryPopup.enterChat clears it for this reason;
    // this path did not.
    clearStoredSession();
    window.location.href = "/";
  }, [currentGroupId]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  return (
    <DropdownWrapper ref={wrapperRef}>
      <Trigger
        $isCollapsed={isCollapsed}
        onClick={() => setIsOpen((o) => !o)}
        title={isCollapsed ? displayName : undefined}
      >
        <WorkspaceIcon>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </WorkspaceIcon>
        {!isCollapsed && (
          <>
            <WorkspaceName>{displayName}</WorkspaceName>
            <ChevronIcon $open={isOpen}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </ChevronIcon>
          </>
        )}
      </Trigger>

      {isOpen && (
        <Dropdown $isCollapsed={isCollapsed}>
          <DropdownLabel>Workspaces</DropdownLabel>
          {workspaces.map((w) => {
            const name = w.alias || w.groupId.slice(0, 12) + "…";
            const active = w.groupId === currentGroupId;
            return (
              <DropdownItem
                key={w.groupId}
                $active={active}
                onClick={() => handleSelect(w.groupId)}
                title={name}
              >
                {active ? <ActiveDot /> : <EmptyDot />}
                {name}
              </DropdownItem>
            );
          })}
        </Dropdown>
      )}
    </DropdownWrapper>
  );
}
