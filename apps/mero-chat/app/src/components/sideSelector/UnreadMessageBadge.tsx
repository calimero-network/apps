import { styled } from "styled-components";

const MessagesBubble = styled.div<{ $backgroundColor?: string }>`
  color: #fff;
  ${({ $backgroundColor }) =>
    $backgroundColor && `background-color: ${$backgroundColor};`}
  display: flex;
  border-radius: 9999px;
  justify-content: center;
  align-items: center;
  font-style: normal;
  font-weight: 700;
  line-height: normal;
  font-size: 12px;
  padding-left: 0.5rem;
  padding-right: 0.5rem;
`;

interface UnreadMessagesBadgeProps {
  messageCount: number | string;
  backgroundColor?: string;
}

export default function UnreadMessagesBadge(props: UnreadMessagesBadgeProps) {
  const { messageCount, backgroundColor } = props;
  return (
    <MessagesBubble $backgroundColor={backgroundColor}>
      {messageCount}
    </MessagesBubble>
  );
}
