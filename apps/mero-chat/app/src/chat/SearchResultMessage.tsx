import { useMemo } from "react";
import { styled } from "styled-components";
import { useDisplayName } from "../repositories/names/useNames";
import { IdentityAvatar } from "../components/IdentityAvatar";
import type { SearchResult } from "../hooks/messageSearch";

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: #ffffff;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const AvatarWrapper = styled.div`
  flex-shrink: 0;
`;

const SenderBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const SenderName = styled.div`
  color: #ffffff;
  font-weight: 600;
  font-size: 15px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SenderId = styled.div`
  color: #777583;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 280px;
`;

const Timestamp = styled.div`
  margin-left: auto;
  color: #b2b1bb;
  font-size: 12px;
  white-space: nowrap;
`;

const Snippet = styled.div`
  color: #ffffff;
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;

  mark {
    background: rgba(165, 255, 17, 0.25);
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
  }
`;

const ThreadBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(87, 101, 242, 0.15);
  color: #a8b7ff;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  width: fit-content;
`;

const ContextLabel = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(165, 255, 17, 0.08);
  color: rgba(165, 255, 17, 0.7);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  width: fit-content;
`;

interface SearchResultMessageProps {
  result: SearchResult;
}

/**
 * One search hit: who, when, where, and the words around the match.
 *
 * The snippet is plain text the contract cut around the first match, with the
 * match's position; highlighting it is slicing, never re-matching, so it marks
 * exactly what the contract matched however the text was folded.
 */
export default function SearchResultMessage({
  result,
}: SearchResultMessageProps) {
  const displayName = useDisplayName(result.sender);
  const timestampLabel = useMemo(
    () =>
      new Date(result.timestamp).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [result.timestamp],
  );
  const { snippet, matchStart, matchEnd } = result;
  const marked = matchEnd > matchStart && matchEnd <= snippet.length;

  return (
    <Wrapper>
      <ContextLabel># {result.contextLabel}</ContextLabel>
      {result.parentMessageId && <ThreadBadge>↩ Thread reply</ThreadBadge>}
      <Header>
        <AvatarWrapper>
          <IdentityAvatar
            size="md"
            identity={result.sender}
            contextId={result.contextId}
            name={displayName || result.sender}
          />
        </AvatarWrapper>
        <SenderBlock>
          <SenderName>{displayName}</SenderName>
          <SenderId>{result.sender}</SenderId>
        </SenderBlock>
        <Timestamp>{timestampLabel}</Timestamp>
      </Header>
      <Snippet>
        {marked ? (
          <>
            {snippet.slice(0, matchStart)}
            <mark>{snippet.slice(matchStart, matchEnd)}</mark>
            {snippet.slice(matchEnd)}
          </>
        ) : (
          snippet
        )}
      </Snippet>
    </Wrapper>
  );
}
