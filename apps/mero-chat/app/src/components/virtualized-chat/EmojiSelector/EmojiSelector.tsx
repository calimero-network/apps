import styled from "styled-components";

import { emojiObj } from "./EmojiList";

interface CloseIconProps {
  onClose: () => void;
}
const CloseIcon = (props: CloseIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    fill="#fff"
    viewBox="0 0 16 16"
    onClick={props.onClose}
  >
    <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z" />
  </svg>
);

interface EmojiSelectorProps {
  onEmojiSelected: (emoji: string) => void;
  onClose: () => void;
}

const EmojiSelector = (props: EmojiSelectorProps) => {
  const EmojiSelectorWrapper = styled.div`
    pointer-events: auto;
    position: relative;
    border-radius: 8px;
    background: #0e0e10;
    border: 1px solid #777583;
    width: 375px;
    padding: 16px;
    height: 200px;
    display: flex;
    flex-direction: column;
    ::-webkit-scrollbar {
      width: 0px;
    }
    .emoji-list {
      margin-top: 8px;
      display: grid;
      grid-template-columns: repeat(11, 1fr);
      gap: 8px;
      cursor: pointer;
      overflow: scroll;
      height: 135px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .title {
      color: #b5b5b5;
      font-family: Helvetica Neue;
      font-size: 12px;
      font-style: normal;
      font-weight: 500;
      line-height: 14.4px;
    }
  `;

  return (
    <EmojiSelectorWrapper>
      <div className="emojis-wrapper">
        <div className="header">
          <span className="title">All emojis</span>
          <CloseIcon onClose={props.onClose} />
        </div>
        <div className="emoji-list">
          {Object.values(emojiObj).flatMap((emojiItems) =>
            emojiItems.map((emojiItem, id) => (
              <div
                key={emojiItem.emoji + id}
                onClick={() => props.onEmojiSelected(emojiItem.emoji)}
              >
                {emojiItem.emoji}
              </div>
            )),
          )}
        </div>
      </div>
    </EmojiSelectorWrapper>
  );
};

export default EmojiSelector;
