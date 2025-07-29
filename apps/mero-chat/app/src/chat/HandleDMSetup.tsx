import { styled } from "styled-components";
import type { ActiveChat } from "../types/Common";

export const Wrapper = styled.div`
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  color: white;
  font-family: Helvetica Neue;
  text-align: center;
  padding: 2rem;
`;

const Title = styled.h1`
  font-size: 24px;
  font-weight: 500;
  line-height: 120%;
  margin-bottom: 1rem;
  color: white;
`;

const Message = styled.p`
  font-size: 16px;
  font-weight: 400;
  line-height: 150%;
  color: #777583;
  margin-bottom: 0.5rem;
`;

const Button = styled.button`
  background-color: #5765f2;
  color: white;
  border: none;
  border-radius: 4px;
  font-family: Helvetica Neue;
  font-size: 16px;
  font-weight: 400;
  line-height: 150%;
  padding: 12px 24px;
  cursor: pointer;
  margin-top: 1rem;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: #717cf0;
  }

  &:active {
    background-color: #4a5bd1;
  }
`;

export default function HandleDMSetup({
  activeChat,
}: {
  activeChat: ActiveChat;
}) {
  if (!activeChat.otherIdentityNew) {
    return (
      <Wrapper>
        <Title>Setup</Title>
        <Message>You are waiting for the other user to set up their new identity.</Message>
        <Message>Please wait for the other user to set up their new identity.</Message>
      </Wrapper>
    );
  }

  if (!activeChat.account) {
    return (
      <Wrapper>
        <Title>Create new identity</Title>
        <Message>Button create and save new identity</Message>
        <Button>Create new identity</Button>
      </Wrapper>
    );
  }
  
  return <></>;
}
