import React from "react";
import styled from "styled-components";

const ButtonContainer = styled.div<{ show: boolean }>`
  position: absolute;
  bottom: 20px;
  right: 20px;
  z-index: 1000;
  opacity: ${(props) => (props.show ? 1 : 0)};
  visibility: ${(props) => (props.show ? "visible" : "hidden")};
  transition:
    opacity 0.2s ease-in-out,
    visibility 0.2s ease-in-out;
`;

const Button = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: #007bff;
  color: white;
  border: none;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transition: all 0.2s ease-in-out;

  &:hover {
    background-color: #0056b3;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    transform: translateY(-2px);
  }

  &:active {
    transform: translateY(0);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  svg {
    width: 20px;
    height: 20px;
  }
`;

interface ScrollToBottomButtonProps {
  show: boolean;
  onClick: () => void;
}

const ScrollToBottomButton: React.FC<ScrollToBottomButtonProps> = ({
  show,
  onClick,
}) => {
  return (
    <ButtonContainer show={show}>
      <Button onClick={onClick} aria-label="Scroll to bottom">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
          <polyline points="6 3 12 9 18 3" />
        </svg>
      </Button>
    </ButtonContainer>
  );
};

export default ScrollToBottomButton;
