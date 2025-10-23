import React, { useState } from "react";
import styled from "styled-components";
import Avatar from "./Avatar";

const OverlayContainer = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3000;
  display: flex;
  justify-content: center;
  align-items: center;
  pointer-events: none;

  @media (max-width: 1024px) {
    align-items: center;
    padding: 1rem;
  }
`;

const Container = styled.div`
  position: relative;
  width: 400px;
  max-width: 90vw;
  max-height: 50vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  background-color: #1d1d21;
  border-radius: 8px;
  padding: 1rem;
  pointer-events: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);

  @media (max-width: 1024px) {
    width: 90vw;
    max-height: 60vh;
    margin: 1rem;
  }
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
`;

const Title = styled.h2`
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  margin: 0;
`;

const CloseButton = styled.button`
  background: transparent;
  border: none;
  color: #777583;
  font-size: 16px;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
  transition: all 0.2s ease;

  &:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
  }
`;

const ContentContainer = styled.div`
  display: flex;
  flex-direction: row;
  gap: 0.75rem;
  flex: 1;
  min-height: 0;

  @media (max-width: 1024px) {
    flex-direction: column;
  }
`;

const ReactionsSidebar = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  width: 80px;
  min-width: 80px;
  max-height: 200px;
  overflow-y: auto;
  padding: 0.25rem;

  @media (max-width: 1024px) {
    width: 100%;
    min-width: unset;
    max-height: 80px;
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
  }

  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.2);
    border-radius: 6px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background-color: rgba(255, 255, 255, 0.3);
  }
`;

const ReactionEmojiWrapper = styled.div<{ $selected: boolean }>`
  position: relative;
  height: 28px;
  padding: 4px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 3px;
  ${({ $selected }) =>
    $selected ? "background-color: #2E2F3D;" : "background-color: transparent;"}
  &:hover {
    background-color: #2a2b37;
  }
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  min-width: fit-content;

  @media (max-width: 1024px) {
    min-width: 50px;
    flex-shrink: 0;
  }
`;

const ReactionCountWrapper = styled.div`
  font-size: 12px;
  line-height: 100%;
  color: #fff;
  font-weight: 500;
`;

const UsersContainer = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
`;

const UsersList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-height: 200px;
  overflow-y: auto;
  padding: 0.25rem 0;

  @media (max-width: 1024px) {
    max-height: 150px;
  }

  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.2);
    border-radius: 6px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background-color: rgba(255, 255, 255, 0.3);
  }
`;

const UserInfoContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem;
  border-radius: 4px;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: rgba(255, 255, 255, 0.05);
  }
`;

const NameContainer = styled.div`
  display: flex;
  align-items: center;
  width: 100%;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.4;
  color: #fff;
`;

const EmptyState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: #777583;
  font-size: 14px;
  text-align: center;
`;

const ShowMoreButton = styled.button`
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #777583;
  font-size: 12px;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-top: 0.5rem;
  white-space: nowrap;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;

  @media (max-width: 1024px) {
    height: 20px;
    padding: 0.2rem 0.4rem;
    font-size: 11px;
  }

  &:hover {
    color: #fff;
    border-color: rgba(255, 255, 255, 0.4);
  }
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
  closeMessageReactionsList: () => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}> = ({
  reactions,
  selectedReaction,
  closeMessageReactionsList,
  isOpen,
  setIsOpen,
}) => {
  const [selected, setSelected] = useState<
    | {
        reaction: string;
        accounts: string[];
      }
    | undefined
  >(selectedReaction);

  const [showAllReactions, setShowAllReactions] = useState(false);
  const [showAllUsers, setShowAllUsers] = useState(false);

  // Limit reactions display to 10 initially
  const displayedReactions = showAllReactions ? reactions : reactions.slice(0, 10);
  const hasMoreReactions = reactions.length > 10;

  // Limit users display to 20 initially
  const displayedUsers = showAllUsers ? selected?.accounts : selected?.accounts.slice(0, 20);
  const hasMoreUsers = selected?.accounts && selected.accounts.length > 20;

  const handleClose = () => {
    setIsOpen(false);
    closeMessageReactionsList();
  };

  if (!isOpen) return null;

  return (
    <OverlayContainer onClick={handleClose}>
      <Container onClick={(e) => e.stopPropagation()}>
        <Header>
          <Title>Message Reactions</Title>
          <CloseButton onClick={handleClose}>
            <i className="bi bi-x-lg"></i>
          </CloseButton>
        </Header>

        <ContentContainer>
          <ReactionsSidebar>
            {displayedReactions.map(
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
            {hasMoreReactions && (
              <ShowMoreButton onClick={() => setShowAllReactions(!showAllReactions)}>
                {showAllReactions ? "Show Less" : `+${reactions.length - 10} More`}
              </ShowMoreButton>
            )}
          </ReactionsSidebar>

          <UsersContainer>
            <UsersList>
              {selected?.accounts && selected.accounts.length > 0 ? (
                <>
                  {displayedUsers?.map((account, id) => (
                    <UserInfoContainer key={id}>
                      <Avatar size="sm" name={account} />
                      <NameContainer>{account}</NameContainer>
                    </UserInfoContainer>
                  ))}
                  {hasMoreUsers && (
                    <ShowMoreButton onClick={() => setShowAllUsers(!showAllUsers)}>
                      {showAllUsers ? "Show Less" : `+${selected.accounts.length - 20} More`}
                    </ShowMoreButton>
                  )}
                </>
              ) : (
                <EmptyState>
                  {selected ? "No users reacted with this emoji" : "Select a reaction to see who reacted"}
                </EmptyState>
              )}
            </UsersList>
          </UsersContainer>
        </ContentContainer>
      </Container>
    </OverlayContainer>
  );
};

export default MessageReactionList;
