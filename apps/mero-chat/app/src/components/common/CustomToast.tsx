import React, { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { sanitizeHtml } from '../virtualized-chat/utils';

const slideIn = keyframes`
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
`;

const slideOut = keyframes`
  from {
    transform: translateX(0);
    opacity: 1;
  }
  to {
    transform: translateX(100%);
    opacity: 0;
  }
`;

const ToastContainer = styled.div<{ $isVisible: boolean; $type: 'channel' | 'dm' | 'mention' }>`
  position: relative;
  max-width: 400px;
  min-width: 300px;
  background-color: #1a1a1f;
  border: 1px solid ${props => {
    if (props.$type === 'mention') return '#73b30c';
    if (props.$type === 'dm') return '#73b30c';
    return '#282933';
  }};
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  animation: ${props => props.$isVisible ? slideIn : slideOut} 0.3s ease-in-out;
  transform: ${props => props.$isVisible ? 'translateX(0)' : 'translateX(100%)'};
  opacity: ${props => props.$isVisible ? 1 : 0};
  transition: all 0.3s ease-in-out;
`;

const ToastHeader = styled.div<{ $type: 'channel' | 'dm' | 'mention' }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 8px 16px;
  border-bottom: 1px solid #282933;
`;

const ToastTitle = styled.div`
  color: #fff;
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ToastIcon = styled.div<{ $type: 'channel' | 'dm' | 'mention' }>`
  width: 20px;
  height: 20px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: ${props => {
    if (props.$type === 'mention') return '#73b30c';
    if (props.$type === 'dm') return '#73b30c';
    return '#282933';
  }};
  color: #fff;
  font-size: 12px;
  font-weight: 600;
`;

const ToastCloseButton = styled.button`
  background: none;
  border: none;
  color: #777583;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s ease;
  
  &:hover {
    color: #fff;
    background-color: rgba(255, 255, 255, 0.1);
  }
`;

const ToastContent = styled.div`
  padding: 8px 16px 12px 16px;
  color: #e4e4e7;
  font-family: 'Helvetica Neue', sans-serif;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
  word-wrap: break-word;
  
  /* Remove HTML tags and style plain text */
  p {
    margin: 0 0 4px 0;
    padding: 0;
  }
  
  p:last-child {
    margin-bottom: 0;
  }
  
  /* Style links */
  a {
    color: #4e95ff;
    text-decoration: none;
  }
  
  a:hover {
    color: #74abff;
    text-decoration: underline;
  }
  
  /* Style mentions */
  .mention {
    background-color: #73b30c;
    color: #fff;
    padding: 2px 4px;
    border-radius: 3px;
    font-weight: 500;
  }
  
  /* Style code */
  code {
    background-color: #1e1e1e;
    color: #fff;
    padding: 2px 4px;
    border-radius: 3px;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 12px;
  }
`;

interface CustomToastProps {
  title: string;
  message: string;
  type: 'channel' | 'dm' | 'mention';
  duration?: number;
  onClose: () => void;
}

const getIcon = (type: 'channel' | 'dm' | 'mention') => {
  switch (type) {
    case 'channel':
      return '#';
    case 'dm':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path fill="#73B30C" d="M20 2H4C2.895 2 2 2.895 2 4V18C2 19.105 2.895 20 4 20H7V23L12 20H20C21.105 20 22 19.105 22 18V4C22 2.895 21.105 2 20 2ZM20 18H11.586L9 19.828V18H4V4H20V18Z"/>
        </svg>
      );
    case 'mention':
      return '@';
    default:
      return '📢';
  }
};

export const CustomToast: React.FC<CustomToastProps> = ({
  title,
  message,
  type,
  duration = 5000,
  onClose,
}) => {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300); // Wait for animation to complete
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(onClose, 300);
  };

  // Strip HTML tags and sanitize the message
  const sanitizedMessage = sanitizeHtml(message);

  return (
    <ToastContainer $isVisible={isVisible} $type={type}>
      <ToastHeader $type={type}>
        <ToastTitle>
          <ToastIcon $type={type}>
            {getIcon(type)}
          </ToastIcon>
          {title}
        </ToastTitle>
        <ToastCloseButton onClick={handleClose}>
          ✕
        </ToastCloseButton>
      </ToastHeader>
      <ToastContent dangerouslySetInnerHTML={{ __html: sanitizedMessage }} />
    </ToastContainer>
  );
};
