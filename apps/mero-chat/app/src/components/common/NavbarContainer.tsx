import type { ActiveChat, User } from "../../types/Common";
import CurbNavbar from "../navbar/CurbNavbar";
import ChannelNavbarContainer from "./ChannelNavbarContainer";

interface NavbarContainerProps {
  activeChat: ActiveChat | null;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
  isOpenSearchChannel: boolean;
  setIsOpenSearchChannel: (isOpen: boolean) => void;
  channelUserList: User[];
}

export default function NavbarContainer(props: NavbarContainerProps) {
  return (
    <>
    {props.activeChat?.type === 'channel' ? (
      <ChannelNavbarContainer {...props} />
    ) : (
      <CurbNavbar {...props} />
    )}
  </>
  );
}
