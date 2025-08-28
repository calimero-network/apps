import type { DMChatInfo } from "../../api/clientApi";
import type { ActiveChat } from "../../types/Common";
import UserItem from "./UserItem";

interface UserListProps {
  selectedDM: string;
  onDMSelected: (user?: DMChatInfo, sc?: ActiveChat, refetch?: boolean) => void;
  privateDMs: DMChatInfo[];
}

export default function UserList({
  selectedDM,
  onDMSelected,
  privateDMs,
}: UserListProps) {
  return (
    <>
      {privateDMs &&
        privateDMs.map((userDM: DMChatInfo) => (
          <UserItem
            userDM={userDM}
            onDMSelected={onDMSelected}
            selected={selectedDM === userDM.other_identity_old}
            key={userDM.other_identity_old}
          />
        ))}
    </>
  );
}
