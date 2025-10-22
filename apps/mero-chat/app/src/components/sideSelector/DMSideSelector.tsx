import { memo } from "react";
import { styled } from "styled-components";
import DMHeader from "./DMHeader";
import UserList from "./UserList";
import type { DMChatInfo } from "../../api/clientApi";
import type { CreateContextResult } from "../popups/StartDMPopup";
import type { ActiveChat } from "../../types/Common";

const DMContainer = styled.div`
  background-color: #0e0e10;
  padding-bottom: 1rem;
  @media (max-width: 1024px) {
    width: 100%;
  }
`;

interface DMSideSelectorProps {
  chatMembers: Map<string, string>;
  createDM: (value: string) => Promise<CreateContextResult>;
  onDMSelected: (dm?: DMChatInfo, sc?: ActiveChat, refetch?: boolean) => void;
  selectedDM: string;
  privateDMs: DMChatInfo[];
  isCollapsed?: boolean;
}

function DMSideSelector({
  chatMembers,
  createDM,
  onDMSelected,
  selectedDM,
  privateDMs,
  isCollapsed,
}: DMSideSelectorProps) {
  return (
    <DMContainer>
      <DMHeader
        key="dm-header"
        createDM={createDM}
        chatMembers={chatMembers}
        isCollapsed={isCollapsed}
      />
      <UserList
        selectedDM={selectedDM}
        onDMSelected={onDMSelected}
        privateDMs={privateDMs}
        isCollapsed={isCollapsed}
      />
    </DMContainer>
  );
}

export default memo(DMSideSelector);
