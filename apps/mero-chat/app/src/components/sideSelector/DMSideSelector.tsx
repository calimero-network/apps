import { styled } from "styled-components";
import type { User } from "../../types/Common";
import DMHeader from "./DMHeader";
import UserList from "./UserList";

const DMContainer = styled.div`
  background-color: #0e0e10;
  padding-bottom: 1rem;
  @media (max-width: 1024px) {
    width: 100%;
  }
`;

interface DMSideSelectorProps {
  users: User[];
  createDM: (value: string) => Promise<void>;
  onDMSelected: (dm: User) => void;
  selectedDM: string;
}

export default function DMSideSelector({
  users,
  createDM,
  onDMSelected,
  selectedDM,
}: DMSideSelectorProps) {
  return (
    <DMContainer>
      <DMHeader createDM={createDM} />
      <UserList users={users} selectedDM={selectedDM} onDMSelected={onDMSelected} />
    </DMContainer>
  );
}
