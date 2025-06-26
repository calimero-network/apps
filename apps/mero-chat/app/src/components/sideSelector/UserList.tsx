import type { User } from "../../types/Common";
import UserItem from "./UserItem";

interface UserListProps {
  users: User[];
  selectedDM: string;
  onDMSelected: (user: User) => void;
}

export default function UserList({
  users,
  selectedDM,
  onDMSelected,
}: UserListProps) {
  return (
    <>
      {users.map((user: User) => (
        <UserItem
          user={user}
          onDMSelected={onDMSelected}
          selected={selectedDM === user.id}
          key={user.id}
        />
      ))}
    </>
  );
}
