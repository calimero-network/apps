import React, { useState } from 'react';
import styled from 'styled-components';

import CloseIcon from './Icons/CloseIcon';
import UserProfileIcon from './ProfileIcon/UserProfileIcon';

const OverlayContainer = styled.div`
  left: 0px;
  right: 0px;
  bottom: 0px;
  top: 0px;
  position: fixed;
  justify-content: center;
  align-items: center;
  display: flex;
  z-index: 3000;
`;

const Container = styled.div`
  display: flex;
  flex-direction: row;
  column-gap: 8px;
  background-color: #1d1d21;
  color: #fff;
  font-family: Helvetica Neue;
  height: 563px;
  width: 340px;
  @media (max-width: 1024px) {
    flex-direction: column;
    height: 400px;
  }
`;

const EmojisContainer = styled.div`
  width: 78px;
  padding: 8px;
  gap: 4px;
  overflow-y: auto;
  scrollbar-color: black black;
  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background-color: black;
    border-radius: 6px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background-color: black;
  }
  * {
    scrollbar-color: black black;
  }
  @media (max-width: 1024px) {
    display: flex;
    flex-direction: row;
    width: 323px;
    overflow-x: auto;
    overflow-y: hidden;
  }
`;

const ReactionEmojiWrapper = styled.div<{ $selected: boolean }>`
  position: relative;
  height: 24px;
  padding: 4px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 4px;
  ${({ $selected }) =>
    $selected ? 'background-color: #2E2F3D;' : 'background-color: transparent;'}
  &:hover {
    background-color: #2a2b37;
  }
  border-radius: 4px;
  cursor: pointer;
`;

const ReactionCountWrapper = styled.div`
  font-size: 12px;
  line-height: 100%;
  color: #fff;
`;

const WhoReactedContainer = styled.div`
  display: flex;
  flex-direction: column;
  padding: 12px 12px 8px 12px;
  gap: 16px;
  height: 100%;
  width: 262px;
  @media (max-width: 1024px) {
    width: 310px;
  }
`;

const AccountsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 490px;
  overflow-y: auto;
  scrollbar-color: black black;
  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background-color: black;
    border-radius: 6px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background-color: black;
  }
  * {
    scrollbar-color: black black;
  }
  @media (max-width: 1024px) {
    height: 277px;
  }
`;

const UserInfoContainer = styled.div`
  display: flex;
  column-gap: 0.5rem;
`;

const NameContainer = styled.div`
  display: flex;
  justify-content: start;
  align-items: center;
  width: 100%;
  font-size: 16px;
  font-weight: 400;
  line-height: 24px;
  letter-spacing: 0em;
  text-align: left;
  color: #777583;
`;

const WhoReactedLabel = styled.div`
  display: flex;
  justify-content: start;
  align-items: center
  width: 100%;
  font-size: 15px;
  font-weight: 700;
  text-align: left;
`;

const HeaderContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const MessageReactionList: React.FC<{
  reactions: {
    reaction: string;
    accounts: string[];
  }[];
  selectedReaction:
    | {
        reaction: string;
        accounts: string[];
      }
    | undefined;
  getIconFromCache: (accountId: string) => Promise<string | null>;
  closeMessageReactionsList: () => void;
}> = ({
  reactions,
  selectedReaction,
  getIconFromCache,
  closeMessageReactionsList,
}) => {
  const [selected, setSelected] = useState<
    | {
        reaction: string;
        accounts: string[];
      }
    | undefined
  >(selectedReaction);

  return (
    <OverlayContainer>
      <Container>
        <EmojisContainer>
          {reactions.map(
            (reaction, id) =>
              reaction.accounts.length > 0 && (
                <ReactionEmojiWrapper
                  key={id}
                  $selected={selected?.reaction === reaction.reaction}
                  onClick={() => setSelected(reaction)}
                >
                  {reaction.reaction}
                  <ReactionCountWrapper>
                    {reaction.accounts.length.toString()}
                  </ReactionCountWrapper>
                </ReactionEmojiWrapper>
              ),
          )}
        </EmojisContainer>
        <WhoReactedContainer>
          <HeaderContainer>
            <WhoReactedLabel>People who reacted</WhoReactedLabel>
            <CloseIcon onClose={closeMessageReactionsList} />
          </HeaderContainer>
          <AccountsContainer>
            {selected?.accounts.map((account, id) => (
              <UserInfoContainer key={id}>
                <UserProfileIcon
                  accountId={account}
                  showStatus={true}
                  width="24px"
                  height="24px"
                  active={false}
                  getIconFromCache={getIconFromCache}
                />
                <NameContainer>{account}</NameContainer>
              </UserInfoContainer>
            ))}
          </AccountsContainer>
        </WhoReactedContainer>
      </Container>
    </OverlayContainer>
  );
};

export default MessageReactionList;
