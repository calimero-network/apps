import React, { useState, useRef } from "react";
import styled from "styled-components";

import type { AccountId, CurbString, HashMap, Vec } from "../types/curbTypes";

import MessageReactionsList from "./MessageReactionsList";

const ReactionsWrapper = styled.div`
  display: flex;
  flex-wrap: wrap;
  padding-top: 2px;
  padding-left: 2.5rem;
  width: fit-content;
  max-width: 100%;
  padding-bottom: 4px;
  column-gap: 0.25rem;
  row-gap: 0.25rem;
  font-size: 1rem;
  line-height: 1rem;
  cursor: pointer;
`;

const parseReactions = (
  reactions?: HashMap<CurbString, Vec<AccountId>>,
): {
  reaction: string;
  accounts: string[];
}[] => {
  if (!reactions || Object.keys(reactions).length === 0) {
    return [];
  }

  return Object.entries(reactions).map(([reaction, accountsForReaction]) => {
    return {
      reaction,
      accounts: accountsForReaction ?? [],
    };
  });
};

interface ReactionEmojiWrapperProps {
  $isOwnReaction?: boolean;
}

const ReactionEmojiWrapper = styled.div<ReactionEmojiWrapperProps>`
  height: 24px;
  padding: 4px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 4px;
  ${(props: ReactionEmojiWrapperProps) =>
    props.$isOwnReaction
      ? "background-color: #372D19;"
      : "background-color: #1e1f28;"}
  &:hover {
    ${(props: ReactionEmojiWrapperProps) =>
      props.$isOwnReaction
        ? "background-color: #4D3F24;"
        : "background-color: #2A2B37;"}
  }
  border-radius: 4px;
`;

const ReactionEmojiComponentButtonContainer = styled.div`
  position: relative;
`;

const ReactionAccountsContainer = styled.div`
  color: #fff;
  display: flex;
  align-items: center;
  min-height: 40px;
  width: 281px;
  column-gap: 8px;
  font-size: 1.5rem;
  line-height: 1.75rem;
  background-color: #1d1d21;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 8px;
`;

const HoverContainer = styled.div<{ $isRightSide?: boolean }>`
  position: absolute;
  bottom: 1rem;
  left: ${props => props.$isRightSide ? 'auto' : '0rem'};
  right: ${props => props.$isRightSide ? '0rem' : 'auto'};
  z-index: 40;
  padding: 16px 16px 16px 0px;
  @media (max-width: 1024px) {
    display: none;
  }
`;

const ReactedByReaction = styled.div`
  width: 32px;
  height: 32px;
`;

const ReactedByContainer = styled.div`
  font-family: Helvetica Neue;
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  letter-spacing: 0em;
  text-align: left;
  -webkit-font-smoothing: antialiased applied;
`;

const ReactionCountWrapper = styled.div`
  font-size: 12px;
  line-height: 100%;
  color: #fff;
  -webkit-font-smoothing: antialiased applied;
`;

const OthersButton = styled.span`
  color: #4e95ff;
  text-decoration: underline;
  &:hover {
    color: #73aaff;
  }
`;

const Text = styled.div``;

interface ReactionDescriptionProps {
  accounts: string[];
  openMessageReactionsList: () => void;
}

const ReactionDescription = ({
  accounts,
  openMessageReactionsList,
}: ReactionDescriptionProps) => {
  const accountsCount = accounts.length;

  if (accountsCount <= 3) {
    return <Text>{`reacted by ${accounts.join(", ")}`}</Text>;
  } else {
    const initialAccounts = accounts.slice(0, 3).join(", ");
    const othersCount = accountsCount - 3;
    return (
      <Text>
        {`reacted by ${initialAccounts} and `}
        <OthersButton onClick={openMessageReactionsList}>
          {`${othersCount} other${othersCount > 1 ? "s" : ""}`}
        </OthersButton>
      </Text>
    );
  }
};

interface EmojiComponentButtonProps {
  reaction: {
    reaction: string;
    accounts: string[];
  };
  handleReaction: (reaction: string) => void;
  openMessageReactionsList: (reaction: {
    reaction: string;
    accounts: string[];
  }) => void;
}

const ReactionEmojiComponentButton = ({
  reaction,
  handleReaction,
  openMessageReactionsList,
}: EmojiComponentButtonProps) => {
  const [showWhoReacted, setShowWhoReacted] = useState(false);
  const [isRightSide, setIsRightSide] = useState(false);
  const currentUsername = localStorage.getItem("chat-username") || "";
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    setShowWhoReacted(true);
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      // Check if the right edge of the container is close to the right edge of the viewport
      setIsRightSide(rect.right > viewportWidth - 300); // 300px buffer for the hover container
    }
  };
  
  return (
    <ReactionEmojiComponentButtonContainer
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShowWhoReacted(false)}
    >
      <ReactionEmojiWrapper
        $isOwnReaction={reaction.accounts.includes(currentUsername)}
        onClick={() => handleReaction(reaction.reaction)}
      >
        {reaction.reaction}
        <ReactionCountWrapper>
          {reaction.accounts.length.toString()}
        </ReactionCountWrapper>
      </ReactionEmojiWrapper>
      {showWhoReacted && (
        <HoverContainer $isRightSide={isRightSide}>
          <ReactionAccountsContainer>
            <ReactedByReaction>{reaction.reaction}</ReactedByReaction>
            <ReactedByContainer>
              <ReactionDescription
                accounts={reaction.accounts}
                openMessageReactionsList={() =>
                  openMessageReactionsList(reaction)
                }
              />
            </ReactedByContainer>
          </ReactionAccountsContainer>
        </HoverContainer>
      )}
    </ReactionEmojiComponentButtonContainer>
  );
};

const MessageReactionsField: React.FC<{
  reactions: HashMap<CurbString, Vec<AccountId>>;
  handleReaction: (reaction: string) => void;
  isMessageRectionListVisible: boolean;
  openMessageReactionsList: (reaction: {
    reaction: string;
    accounts: string[];
  }) => void;
  closeMessageReactionsList: () => void;
  selectedReaction:
    | {
        reaction: string;
        accounts: string[];
      }
    | undefined;
}> = ({
  reactions,
  handleReaction,
  isMessageRectionListVisible,
  openMessageReactionsList,
  closeMessageReactionsList,
  selectedReaction,
}) => {
  const parsedReactions = parseReactions(reactions);

  return (
    <>
      <ReactionsWrapper>
        {parsedReactions.map((parsedReaction, id) => (
          <div key={id}>
            {parsedReaction.accounts.length > 0 && (
              <ReactionEmojiComponentButton
                key={id}
                reaction={parsedReaction}
                handleReaction={handleReaction}
                openMessageReactionsList={openMessageReactionsList}
              />
            )}
          </div>
        ))}
      </ReactionsWrapper>
      {isMessageRectionListVisible && (
        <MessageReactionsList
          reactions={parsedReactions}
          selectedReaction={selectedReaction ?? parsedReactions[0]}
          closeMessageReactionsList={closeMessageReactionsList}
          isOpen={isMessageRectionListVisible}
          setIsOpen={(isOpen) => {
            if (!isOpen) {
              closeMessageReactionsList();
            }
          }}
        />
      )}
    </>
  );
};

export default MessageReactionsField;
