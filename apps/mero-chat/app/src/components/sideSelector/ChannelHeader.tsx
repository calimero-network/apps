import { styled } from "styled-components";
import CreateChannelPopup from "../popups/CreateChannelPopup";
import { isValidChannelName } from "../../utils/validation";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import { ChannelType } from "../../api/clientApi";
import { memo } from "react";
import { usePersistentState } from "../../hooks/usePersistentState";

const Container = styled.div<{ $isCollapsed?: boolean }>`
  display: flex;
  justify-content: ${(props) =>
    props.$isCollapsed ? "center" : "space-between"};
  align-items: center;
  background-color: #0e0e10;
  padding-top: 0.375rem;
  padding-bottom: 0.375rem;
  padding-left: 0.75rem;
  padding-right: 0.75rem;
  color: #777583;
  :hover {
    color: #ffffff;
  }
  @media (max-width: 1024px) {
    width: 100%;
    padding-top: 0.5rem;
  }
`;

const TextBold = styled.div`
  font-family: Helvetica Neue;
  font-size: 14px;
  font-style: normal;
  font-weight: 700;
  line-height: 150%;
  color: #777583;
`;
const IconPlusContainer = styled.div`
  display: flex;
  cursor: pointer;
  justify-content: center;
  align-items: center;
  font-size: 1.125rem;
`;

interface ChannelHeaderProps {
  title: string;
  isCollapsed?: boolean;
}

const ChannelHeader = memo(function ChannelHeader(props: ChannelHeaderProps) {
  const [isOpen, setIsOpen] = usePersistentState(
    "createChannelModalOpen",
    false,
  );
  const [inputValue, setInputValue] = usePersistentState(
    "createChannelInputValue",
    "",
  );
  const createChannel = async (
    channelName: string,
    isPublic: boolean,
    isReadyOnly: boolean,
  ) => {
    await new ClientApiDataSource().createChannel({
      channel: { name: channelName },
      channel_type: isPublic ? ChannelType.PUBLIC : ChannelType.PRIVATE,
      read_only: isReadyOnly,
      moderators: [],
      links_allowed: true,
      created_at: Math.floor(Date.now() / 1000),
    });
    // Clear the input and close modal after successful creation
    setInputValue("");
    setIsOpen(false);
  };
  return (
    <Container $isCollapsed={props.isCollapsed}>
      {!props.isCollapsed && <TextBold>{props.title}</TextBold>}
      <CreateChannelPopup
        title={"Create new Channel"}
        inputValue={inputValue}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        setInputValue={setInputValue}
        placeholder={"# channel name"}
        buttonText={"Create"}
        toggle={
          <IconPlusContainer onClick={() => setIsOpen(true)}>
            <i className="bi bi-plus-circle" />
          </IconPlusContainer>
        }
        createChannel={createChannel}
        channelNameValidator={isValidChannelName}
      />
    </Container>
  );
});

export default ChannelHeader;
