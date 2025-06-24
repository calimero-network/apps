import { useState, useEffect } from 'react';
import type { ActiveChat, User } from "../../types/Common";
import CurbNavbar from "../navbar/CurbNavbar";

interface ChannelNavbarContainerProps {
  activeChat: ActiveChat | null;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
  isOpenSearchChannel: boolean;
  setIsOpenSearchChannel: (isOpen: boolean) => void;
}

export default function ChannelNavbarContainer(props: ChannelNavbarContainerProps) {
  const { activeChat } = props;
  
  const [members, setMembers] = useState<User[]>([]);

  useEffect(() => {
    if (activeChat?.type === 'channel') {
      const mockMembers: User[] = [
        { id: '1', name: 'User 1', active: true },
        { id: '2', name: 'User 2', active: true },
        { id: '3', name: 'User 3', active: false },
      ];
      setMembers(mockMembers);
    } else {
      setMembers([]);
    }
  }, [activeChat]);

  return (
    <CurbNavbar
      {...props}
      channelUserList={members}
    />
  );
}
