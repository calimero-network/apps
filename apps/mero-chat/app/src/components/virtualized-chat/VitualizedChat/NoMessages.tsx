// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import React from 'react';
import styled from 'styled-components';

const NoMessageContainer = styled.div`
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  text-align: center;
  @media (max-width: 1024px) {
    padding-top: 3rem;
    width: 100%;
  }
`;

const EmptyStateContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  max-width: 400px;
  margin: 0 auto;
`;

const ChatIcon = styled.div`
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: linear-gradient(135deg, #a5ff11 0%, #73b30c 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 32px rgba(165, 255, 17, 0.3);

  @media (max-width: 768px) {
    width: 32px;
    height: 32px;
  }

  svg {
    width: 30px;
    height: 30px;
    color: white;

    @media (max-width: 768px) {
      width: 20px;
      height: 20px;
    }
  }
`;

const Title = styled.h3`
  color: #fff;
  font-family: Helvetica Neue;
  font-size: 20px;
  font-weight: 500;
  margin: 0;
  text-align: center;

  @media (max-width: 768px) {
    font-size: 16px;
  }
`;

const Subtitle = styled.p`
  color: #777583;
  font-family: Helvetica Neue;
  font-size: 12px;
  font-weight: 400;
  margin: 0;
  text-align: center;
  line-height: 1.5;

  @media (max-width: 768px) {
    font-size: 13px;
  }
`;

const NoMessages = () => (
  <NoMessageContainer>
    <EmptyStateContainer>
      <ChatIcon>
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4l4 4 4-4h4c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z" />
        </svg>
      </ChatIcon>
      <Title>No messages yet</Title>
      <Subtitle>Start the conversation by sending your first message</Subtitle>
    </EmptyStateContainer>
  </NoMessageContainer>
);

export default NoMessages;
