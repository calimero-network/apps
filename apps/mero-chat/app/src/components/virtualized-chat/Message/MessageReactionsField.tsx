import React, { useState } from 'react';
import styled from 'styled-components';

import type { AccountId, CurbString, HashMap, Vec } from '../types/curbTypes';

import MessageReactionsList from './MessageReactionsList';

const ReactionsWrapper = styled.div`
  display: flex;
  padding-top: 2px;
  padding-left: 2.5rem;
  width: fit-content;
  padding-bottom: 4px;
  column-gap: 0.25rem;
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
      ? 'background-color: #372D19;'
      : 'background-color: #1e1f28;'}
  &:hover {
    ${(props: ReactionEmojiWrapperProps) =>
      props.$isOwnReaction
        ? 'background-color: #4D3F24;'
        : 'background-color: #2A2B37;'}
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
  height: 80px;
  width: 281px;
  column-gap: 8px;
  font-size: 1.5rem;
  line-height: 1.75rem;
  background-color: #1d1d21;
  border-radius: 4px;
  padding: 8px;
`;

const HoverContainer = styled.div`
  position: absolute;
  bottom: 1rem;
  left: 0rem;
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
    return <Text>{`reacted by ${accounts.join(', ')}`}</Text>;
  } else {
    const initialAccounts = accounts.slice(0, 3).join(', ');
    const othersCount = accountsCount - 3;
    return (
      <Text>
        {`reacted by ${initialAccounts} and `}
        <OthersButton onClick={openMessageReactionsList}>
          {`${othersCount} other${othersCount > 1 ? 's' : ''}`}
        </OthersButton>
      </Text>
    );
  }
};

interface EmojiComponentButtonProps {
  accountId: string;
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
  accountId,
  reaction,
  handleReaction,
  openMessageReactionsList,
}: EmojiComponentButtonProps) => {
  const [showWhoReacted, setShowWhoReacted] = useState(false);
  return (
    <ReactionEmojiComponentButtonContainer
      onMouseEnter={() => setShowWhoReacted(true)}
      onMouseLeave={() => setShowWhoReacted(false)}
    >
      <ReactionEmojiWrapper
        $isOwnReaction={reaction.accounts.includes(accountId)}
        onClick={() => handleReaction(reaction.reaction)}
      >
        {reaction.reaction}
        <ReactionCountWrapper>
          {reaction.accounts.length.toString()}
        </ReactionCountWrapper>
      </ReactionEmojiWrapper>
      {showWhoReacted && (
        <HoverContainer>
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
  accountId: string;
  handleReaction: (reaction: string) => void;
  getIconFromCache: (accountId: string) => Promise<string | null>;
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
  accountId,
  handleReaction,
  getIconFromCache,
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
                accountId={accountId}
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
          getIconFromCache={getIconFromCache}
          closeMessageReactionsList={closeMessageReactionsList}
        />
      )}
    </>
  );
};

export default MessageReactionsField;
