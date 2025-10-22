import styled from "styled-components";

import EmojiSelector from "./EmojiSelector";

const EmojiPopupContainer = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  right: 2.5rem;
  @media (max-width: 1024px) {
    right: 0;
  }
  display: flex;
  justify-content: end;
  align-items: center;
  z-index: 100;
  pointer-events: none;
`;

interface EmojiSelectorPopupProps {
  onClose: () => void;
  onEmojiSelected: (emoji: string) => void;
}

const EmojiSelectorPopup = (props: EmojiSelectorPopupProps) => {
  return (
    <EmojiPopupContainer>
      <EmojiSelector
        onClose={props.onClose}
        onEmojiSelected={props.onEmojiSelected}
      />
    </EmojiPopupContainer>
  );
};

export default EmojiSelectorPopup;
