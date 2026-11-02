import { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";

import { useWorkspace } from "../../calimero/WorkspaceProvider";

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
  border-radius: 10px;
  cursor: pointer;
  color: var(--glass-ink-2);
  transition: background 0.15s ease, color 0.15s ease;
  min-width: 0;

  &:hover {
    background: color-mix(in srgb, var(--glass-ink) 5%, transparent);
    color: var(--glass-ink);
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
  color: color-mix(in srgb, var(--glass-ink) 40%, transparent);
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
  background: var(--glass-surface-solid);
  border: 1px solid color-mix(in srgb, var(--glass-ink) 10%, transparent);
  border-radius: 14px;
  box-shadow: var(--chat-pop-shadow);
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
  background: ${({ $active }) => ($active ? "color-mix(in srgb, var(--glass-accent) 8%, transparent)" : "transparent")};
  border: none;
  cursor: pointer;
  color: ${({ $active }) => ($active ? "var(--glass-accent)" : "var(--glass-ink-2)")};
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  transition: background 0.12s ease, color 0.12s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &:hover {
    background: color-mix(in srgb, var(--glass-ink) 6%, transparent);
    color: var(--glass-ink);
  }
`;

const ActiveDot = styled.div`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--glass-ink);
  flex-shrink: 0;
`;

const EmptyDot = styled.div`
  width: 6px;
  height: 6px;
  flex-shrink: 0;
`;

const CreateItem = styled(DropdownItem)`
  border-top: 1px solid color-mix(in srgb, var(--glass-ink) 7%, transparent);
  color: var(--glass-ink-2);
  font-weight: 600;
`;

const DropdownLabel = styled.div`
  padding: 0.4rem 0.75rem 0.25rem;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--glass-ink) 25%, transparent);
`;

/**
 * The open workspace (an organization), the others the account is in, and
 * "New workspace", which goes back to the picker where one is created.
 */
export default function WorkspaceSwitcher({ isCollapsed }: WorkspaceSwitcherProps) {
  const ws = useWorkspace();
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const displayName = ws.name || "Workspace";

  const handleSelect = useCallback(
    (org: string) => {
      setIsOpen(false);
      if (org !== ws.org) ws.switchTo(org);
    },
    [ws],
  );

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
      <Trigger $isCollapsed={isCollapsed} onClick={() => setIsOpen((o) => !o)} title={isCollapsed ? displayName : undefined}>
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
          {ws.workspaces.map((w) => {
            const name = w.name || w.orgId.slice(0, 12) + "…";
            const active = w.orgId === ws.org;
            return (
              <DropdownItem key={w.orgId} $active={active} onClick={() => handleSelect(w.orgId)} title={name}>
                {active ? <ActiveDot /> : <EmptyDot />}
                {name}
              </DropdownItem>
            );
          })}
          <CreateItem
            $active={false}
            onClick={() => {
              setIsOpen(false);
              ws.switchTo("");
            }}
            data-testid="workspace-switcher-create"
          >
            <EmptyDot />+ New workspace
          </CreateItem>
        </Dropdown>
      )}
    </DropdownWrapper>
  );
}
