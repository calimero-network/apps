import { styled } from "styled-components";
import EmojiSelector from "./EmojiSelector";

const EmojiPopupContainer = styled.div`
  position: fixed;
  left: 0px;
  right: 0px;
  bottom: 0px;
  top: 0px;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 100;
`;

const CloseButton = styled.div`
  color: #fff;
  :hover {
    color: #5765f2;
  }
  z-index: 40;
  position: absolute;
  top: -30px;
  left: 140px;
  cursor: pointer;
`;

const CloseButtonContainer = styled.div`
  position: relative;
`;

interface EmojiSelectorPopupProps {
  onEmojiSelected: (emoji: string) => void;
  onClose: () => void;
}

export default function EmojiSelectorPopup({
  onEmojiSelected,
  onClose,
}: EmojiSelectorPopupProps) {
  return (
    <EmojiPopupContainer>
      <CloseButtonContainer>
        <CloseButton onClick={onClose}>
          <i className="bi bi-x-lg"></i>
        </CloseButton>
      </CloseButtonContainer>
      <EmojiSelector onEmojiSelected={(emoji) => onEmojiSelected(emoji)} />
    </EmojiPopupContainer>
  );
}
