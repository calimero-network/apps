import { useState } from "react";
import { styled } from "styled-components";
import { emojiObj, type Emoji } from "../utils/emoji";

const TypeSelectorHeader = styled.div`
  display: flex;
  border-top-left-radius: 0.375rem;
  border-top-right-radius: 0.375rem;
  padding-left: 4px;
  pading-right: 4px;
  border-bottom: 1px solid #777583;
`;
const EmojiComponentContainer = styled.div`
  width: fit-content;
  height: 420px;
  background-color: #0e0e10;
  border: 1px solid #777583;
  border-radius: 0.375rem;
  @media (max-width: 1024px) {
    height: 362px;
  }
`;

const IconContainer = styled.div<{ selected: boolean }>`
  width: 32px;
  height: 32px;
  padding: 8px;
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  ${({ selected }) => selected && 'border-bottom: 1px solid #009900;'}
  transition: background-color 500ms ease
`;

const SelectedTypeTitle = styled.div`
  font-style: normal;
  font-weight: 600;
  line-height: normal;
  font-size: 12px;
  padding-left: 24px;
  margin-top: 0.725rem;
  color: #777583;
`;

const typesIcons = [
  'bi-emoji-smile',
  'bi-tree',
  'bi-egg-fill',
  'bi-controller',
  'bi-globe-americas',
  'bi-lamp-fill',
  'bi-shield',
  'bi-flag-fill',
];

const typesNames = [
  'People',
  'Nature',
  'Food and Drinks',
  'Activity',
  'Travel Places',
  'Objects',
  'Symbols',
  'Flags',
];

const typesIds = [
  'People',
  'Nature',
  'Food-drink',
  'Activity',
  'Travel-places',
  'Objects',
  'Symbols',
  'Flags',
];

const EmojiGrid = styled.div`
  height: 300px;
  display: grid;
  grid-template-columns: repeat(7, 32px);
  padding-top: 0.5rem;
  padding-left: 16px;
  padding-right: 8px:
  column-gap: 2px;
  row-gap: 2px;
  overflow: scroll;
`;

const EmojiItemDesktop = styled.div`
  cursor: pointer;
  text-align: center;
  padding-bottom: 5px;
  padding-top: 5px;
  height: 30px;
  width: 30px;
  border-radius: 0.375rem;
  :hover {
    background-color: #34343a;
  }
  @media (max-width: 1024px) {
    display: none;
  }
`;

const EmojiItemMobile = styled.div`
  cursor: pointer;
  text-align: center;
  padding-bottom: 5px;
  padding-top: 5px;
  height: 30px;
  width: 30px;
  border-radius: 0.375rem;
  :hover {
    background-color: #34343a;
  }
  @media (min-width: 1024px) {
    display: none;
  }
`;

const DisplayEmojiGrid = styled.div`
  display: flex;
  align-items: center;
  column-gap: 4px;
  width: 100%;
  height: 58px;
  border-bottom-left-radius: 0.375rem;
  border-bottom-right-radius: 0.375rem;
  border-top: 1px solid #777583;
  font-style: normal;
  font-weight: 600;
  padding-top: 1rem;
  line-height: normal;
  font-size: 12px;
  color: #777583;
  padding-left: 8px;
  padding-right: 8px;
  overflow: hidden;
  @media (max-width: 1024px) {
    display: none;
  }
`;

const EmojiDisplay = styled.div`
  display: flex;
  align-items: center;
  overflow: hidden;
  font-style: normal;
  font-weight: 600;
  line-height: normal;
  font-size: 12px;
  color: #777583;
`;

interface EmojiSelectorProps {
  onEmojiSelected: (emoji: string) => void;
}

export default function EmojiSelector({
  onEmojiSelected,
}: EmojiSelectorProps) {
  const [selected, setSelected] = useState(0);
  const [hoverStateHeader, setHoverStateHeader] = useState(-1);
  const [hoveredEmoji, setHoveredEmoji] = useState<Emoji | null>(null);
  
  
  const updateHoveredEmoji = (emoji: Emoji | null) => {
    setHoveredEmoji(emoji);
  };
  const updateHoverStateHeader = (id: number) => {
    setHoverStateHeader(id);
  };
  
  const updateSelectedType = (id: number) => {
    setSelected(id);
  };

  return (
    <EmojiComponentContainer>
      <TypeSelectorHeader>
        {typesIcons.map((icon, id) => {
          return (
            <IconContainer
              selected={id === selected || id === hoverStateHeader}
              onClick={() => updateSelectedType(id)}
              key={`types-${id}`}
              onMouseEnter={() => updateHoverStateHeader(id)}
              onMouseLeave={() => updateHoverStateHeader(-1)}
            >
              <i className={`bi ${icon} text-light`}></i>
            </IconContainer>
          );
        })}
      </TypeSelectorHeader>
      <SelectedTypeTitle>{typesNames[selected]}</SelectedTypeTitle>
      <EmojiGrid>
        {emojiObj[typesIds[selected] as keyof typeof emojiObj].map((item: Emoji, id: number) => (
          <div key={id+item.emoji}>
            <EmojiItemDesktop
              key={`desktop-${id}`}
              onMouseEnter={() => updateHoveredEmoji(item)}
              onMouseLeave={() => updateHoveredEmoji(null)}
              onClick={() => {
                onEmojiSelected(item.emoji);
              }}
            >
              <p>{item.emoji}</p>
            </EmojiItemDesktop>
            <EmojiItemMobile
              key={`mobile-${id}`}
              onClick={() => {
                onEmojiSelected(item.emoji);
              }}
            >
              <p>{item.emoji}</p>
            </EmojiItemMobile>
          </div>
        ))}
      </EmojiGrid>
      <DisplayEmojiGrid>
        <p>Emoji: </p>
        {hoveredEmoji && (
          <EmojiDisplay>
            <p>{hoveredEmoji.emoji}</p>
            <p>{hoveredEmoji.title}</p>
          </EmojiDisplay>
        )}
      </DisplayEmojiGrid>
    </EmojiComponentContainer>
  );
  
}
