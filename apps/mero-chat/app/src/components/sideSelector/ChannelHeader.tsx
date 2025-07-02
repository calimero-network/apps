import { styled } from "styled-components";
import CreateChannelPopup from "../popups/CreateChannelPopup";
import { isValidChannelName } from "../../utils/validation";

const Container = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: #0e0e10;
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
  padding-left: 1rem;
  padding-right: 1rem;
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
  font-size: 16px;
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
  font-size: 1.25rem;
`;

interface ChannelHeaderProps {
  title: string;
}

export default function ChannelHeader(props: ChannelHeaderProps) {
  return (
    <Container>
      <TextBold>{props.title}</TextBold>
      <CreateChannelPopup
          title={"Create new Channel"}
          placeholder={"# channel name"}
          buttonText={"Create"}
          colors={{
            base: "#5765f2",
            hover: "#717cf0",
            disabled: "#3B487A",
          }}
          toggle={
            <IconPlusContainer>
              <i className="bi bi-plus-circle" />
            </IconPlusContainer>
          }
        createChannel={async (channelName, isPublic, isReadOnly) => {
          await console.log(channelName, isPublic, isReadOnly);
        }}
        channelNameValidator={isValidChannelName}
      />
    </Container>
  );
}
