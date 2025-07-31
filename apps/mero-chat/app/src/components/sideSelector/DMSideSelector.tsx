import { styled } from "styled-components";
import DMHeader from "./DMHeader";
import UserList from "./UserList";
import type { DMChatInfo, UserId } from "../../api/clientApi";
import type { CreateContextResult } from "../popups/StartDMPopup";

const DMContainer = styled.div`
  background-color: #0e0e10;
  padding-bottom: 1rem;
  @media (max-width: 1024px) {
    width: 100%;
  }
`;

interface DMSideSelectorProps {
  chatMembers: UserId[];
  createDM: (value: string) => Promise<CreateContextResult>;
  onDMSelected: (dm: DMChatInfo) => void;
  selectedDM: string;
  privateDMs: DMChatInfo[];
}

export default function DMSideSelector({
  chatMembers,
  createDM,
  onDMSelected,
  selectedDM,
  privateDMs
}: DMSideSelectorProps) {
  return (
    <DMContainer>
      <DMHeader createDM={createDM} chatMembers={chatMembers}/>
      <UserList selectedDM={selectedDM} onDMSelected={onDMSelected} privateDMs={privateDMs} />
    </DMContainer>
  );
}
