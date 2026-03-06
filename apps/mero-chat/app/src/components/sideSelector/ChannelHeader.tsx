import { styled } from "styled-components";
import CreateChannelPopup from "../popups/CreateChannelPopup";
import { isValidChannelName } from "../../utils/validation";
import { ClientApiDataSource } from "../../api/dataSource/clientApiDataSource";
import { ChannelType } from "../../api/clientApi";
import { memo } from "react";
import { usePersistentState } from "../../hooks/usePersistentState";

const Container = styled.div<{ $isCollapsed?: boolean }>`
  display: flex;
  justify-content: ${(props) => (props.$isCollapsed ? "center" : "space-between")};
  align-items: center;
  padding: 0.25rem 0.75rem 0.25rem ${(props) => (props.$isCollapsed ? "0.75rem" : "1rem")};
  margin-bottom: 0.125rem;
  @media (max-width: 1024px) {
    width: 100%;
    padding-top: 0.5rem;
  }
`;

const TextBold = styled.div`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
`;

const PlusButton = styled.div`
  display: flex;
  cursor: pointer;
  justify-content: center;
  align-items: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  color: rgba(255, 255, 255, 0.25);
  transition: all 0.15s ease;

  &:hover {
    color: #a5ff11;
    background: rgba(165, 255, 17, 0.1);
  }

  svg {
    stroke: currentColor;
  }
`;

interface ChannelHeaderProps {
  title: string;
  isCollapsed?: boolean;
}

const ChannelHeader = memo(function ChannelHeader(props: ChannelHeaderProps) {
  const [isOpen, setIsOpen] = usePersistentState("createChannelModalOpen", false);
  const [inputValue, setInputValue] = usePersistentState("createChannelInputValue", "");

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
          <PlusButton onClick={() => setIsOpen(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </PlusButton>
        }
        createChannel={createChannel}
        channelNameValidator={isValidChannelName}
      />
    </Container>
  );
});

export default ChannelHeader;
