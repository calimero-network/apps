import React, { useState, useEffect } from 'react';
import styled from 'styled-components';

import { elapsedTime } from '../utils';

const Container = styled.div`
  width: fit-content;
  display: flex;
  padding-left: 2.5rem;
  @media (max-width: 1024px) {
    padding-left: 3.5rem;
  }
  justify-content: space-between;
  align-items: center;
`;

const ReplyText = styled.div`
  font-size: 12px;
  line-height: 150%;
  color: #4e95ff;
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
`;

const TimestampText = styled.div`
  font-size: 12px;
  line-height: 100%;
  color: #777583;
  padding-left: 0.5rem;
`;

const LeftContainer = styled.div`
  display: flex;
  align-items: center;
  column-gap: 0.5rem;
  color: #fff;
  cursor: pointer;
`;

const IconChat = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    fill="white"
    className="bi bi-chat-text"
    viewBox="0 0 16 16"
  >
    <path d="M2.678 11.894a1 1 0 0 1 .287.801 10.97 10.97 0 0 1-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 0 1 .71-.074A8.06 8.06 0 0 0 8 14c3.996 0 7-2.807 7-6 0-3.192-3.004-6-7-6S1 4.808 1 8c0 1.468.617 2.83 1.678 3.894zm-.493 3.905a21.682 21.682 0 0 1-.713.129c-.2.032-.352-.176-.273-.362a9.68 9.68 0 0 0 .244-.637l.003-.01c.248-.72.45-1.548.524-2.319C.743 11.37 0 9.76 0 8c0-3.866 3.582-7 8-7s8 3.134 8 7-3.582 7-8 7a9.06 9.06 0 0 1-2.347-.306c-.52.263-1.639.742-3.468 1.105z" />
    <path d="M4 5.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zM4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8zm0 2.5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 1-.5-.5z" />
  </svg>
);

const ReplyContainerButton: React.FC<{
  replyCount: number;
  onClick: () => void;
  lastTimestamp: number;
}> = (props) => {
  const [hover, setHover] = useState(false);
  const [time, setTime] = useState(() => elapsedTime(props.lastTimestamp)); // Step 1: Create time state

  useEffect(() => {
    const interval = setInterval(() => {
      // Step 2: Start interval
      setTime(elapsedTime(props.lastTimestamp));
    }, 60000); // Update every minute

    return () => clearInterval(interval); // Step 3: Clear interval on unmount
  }, [props.lastTimestamp]);
  return (
    <Container
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={props.onClick}
    >
      <LeftContainer>
        <IconChat />
        <ReplyText>
          {props.replyCount > 1
            ? `${props.replyCount} replies`
            : `${props.replyCount} reply`}
        </ReplyText>
        <TimestampText>{hover ? 'View thread' : time}</TimestampText>
      </LeftContainer>
    </Container>
  );
};

export default ReplyContainerButton;
