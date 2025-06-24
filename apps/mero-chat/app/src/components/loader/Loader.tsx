import React from 'react';
import styled, { keyframes } from 'styled-components';

interface LoaderProps {
  size?: number;
  color?: string;
}

const spin = keyframes`
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
`;

const LoaderStyled = styled.div<LoaderProps>`
  display: inline-block;
  ${({ size }) =>
    size
      ? `width: ${size}px; height: ${size}px;`
      : 'width: 20px; height: 20px;'}
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  ${({ color }) =>
    color ? `border-top-color: ${color};` : 'border-top-color: #fff;'}
  animation: ${spin} 1s ease-in-out infinite;
  -webkit-animation: ${spin} 1s ease-in-out infinite;
`;

const Loader: React.FC<LoaderProps> = ({ size, color }) => {
  return <LoaderStyled size={size} color={color} />;
};

export default Loader;
