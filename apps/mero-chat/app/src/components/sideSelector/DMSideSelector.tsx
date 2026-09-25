import { memo } from "react";
import { styled } from "styled-components";
import DMHeader from "./DMHeader";
import UserList from "./UserList";
import type { DMContextInfo } from "../../hooks/useDMs";
import type { CreateContextResult } from "../popups/StartDMPopup";
import type { ContextUnread } from "../../hooks/useUnreadCounts";

const DMContainer = styled.div`
  background-color: #0e0e10;
  padding-bottom: 1rem;
  @media (max-width: 1024px) {
    width: 100%;
  }
`;

interface DMSideSelectorProps {
  dmMembers: Map<string, string>;
  createDM: (value: string) => Promise<CreateContextResult>;
  onDMSelected: (dm: DMContextInfo) => void;
  selectedDM: string;
  privateDMs: DMContextInfo[];
  isCollapsed?: boolean;
  onFetchDmMembers?: () => Promise<void>;
  unreadCounts?: Map<string, ContextUnread>;
}

function DMSideSelector({
  dmMembers,
  createDM,
  onDMSelected,
  selectedDM,
  privateDMs,
  isCollapsed,
  onFetchDmMembers,
  unreadCounts,
}: DMSideSelectorProps) {
  return (
    <DMContainer>
      <DMHeader
        key="dm-header"
        createDM={createDM}
        availableMembers={dmMembers}
        privateDMs={privateDMs}
        isCollapsed={isCollapsed}
        onFetchMembers={onFetchDmMembers}
      />
      <UserList
        selectedDM={selectedDM}
        onDMSelected={onDMSelected}
        privateDMs={privateDMs}
        isCollapsed={isCollapsed}
        unreadCounts={unreadCounts}
      />
    </DMContainer>
  );
}

export default memo(DMSideSelector);
