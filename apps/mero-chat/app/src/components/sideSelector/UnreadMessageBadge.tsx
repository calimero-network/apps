import { styled } from "styled-components";

const MessagesBubble = styled.div<{ $backgroundColor?: string; $color?: string }>`
  color: ${({ $color }) => $color || "#fff"};
  ${({ $backgroundColor }) =>
    $backgroundColor && `background-color: ${$backgroundColor};`}
  display: flex;
  border-radius: 9999px;
  justify-content: center;
  align-items: center;
  font-style: normal;
  font-weight: 700;
  line-height: normal;
  font-size: 11px;
  padding: 1px 6px;
  min-width: 18px;
`;

interface UnreadMessagesBadgeProps {
  messageCount: number | string;
  backgroundColor?: string;
  color?: string;
}

export default function UnreadMessagesBadge(props: UnreadMessagesBadgeProps) {
  const { messageCount, backgroundColor, color } = props;
  return (
    <MessagesBubble $backgroundColor={backgroundColor} $color={color}>
      {messageCount}
    </MessagesBubble>
  );
}
