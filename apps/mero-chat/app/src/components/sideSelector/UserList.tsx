import type { DMChatInfo } from "../../api/clientApi";
import UserItem from "./UserItem";

interface UserListProps {
  selectedDM: string;
  onDMSelected: (user: DMChatInfo) => void;
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
            selected={selectedDM === userDM.channel_user}
            key={userDM.channel_user}
          />
        ))}
    </>
  );
}
