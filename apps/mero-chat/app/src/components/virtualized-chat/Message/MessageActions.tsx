import React, { type CSSProperties } from "react";
import styled from "styled-components";

import { ElementPosition } from "../types/curbTypes";

import ChatTextIcon from "./Icons/ChatTextIcon";
import CheckMarkIcon from "./Icons/CheckMarkIcon";
import EditMessageIcon from "./Icons/EditMessageIcon";
import EmojiWinkIcon from "./Icons/EmojiWinkIcon";
import GrinningFaceIcon from "./Icons/GrinningFaceIcon";
import ThumbsUpIcon from "./Icons/ThumbsUpIcon";
import ThreeDotsIcon from "./Icons/ThreeDotsIcon";
import TrashIcon from "./Icons/TrashIcon";

const styles: CSSProperties = {
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  height: "30px",
  columnGap: "0.5rem",
  fontSize: "1.5rem",
  lineHeight: "1.75rem",
  cursor: "pointer",
  background: "rgb(17, 17, 17)",
  borderRadius: "4px",
  paddingTop: "7px",
  paddingBottom: "7px",
  paddingRight: "2px",
  paddingLeft: "2px",
  position: "relative",
};

const EmojiContainer = styled.span`
  width: 24px;
  height: 24px;
  font-size: 16px;
  border-radius: 4px;
  cursor: pointer;
  text-align: center;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 6px;
  color: #fff;
  @media (max-width: 1024px) {
    -webkit-user-select: none;
    -khtml-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
  }
`;

const ActionContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: #fff;
  font-family: Helvetica Neue;
  padding: 6px 12px 6px 12px;
  font-size: 14px;
  font-weight: 400;
  line-height: 24px;
  letter-spacing: 0em;
  text-align: left;
  border-radius: 4px;
  &:hover {
    background-color: #2e2f3d;
  }
`;

const MoreActionContainer = styled.div`
  position: absolute;
  bottom: 10;
  z-index: 30;
  width: 226px;
  left: -38px;
  padding: 2px;
  border-radius: 4px;
  gap: 4px;
  background-color: rgb(17, 17, 17);
`;

const reactionsArray = [
  {
    emoji: "✅",
    title: "Check Mark Button",
    icon: <CheckMarkIcon />,
  },
  {
    emoji: "👍",
    title: "Thumbs Up",
    icon: <ThumbsUpIcon />,
  },
  {
    emoji: "😀",
    title: "Grinning Face",
    icon: <GrinningFaceIcon />,
  },
];

const ActionsPopup: React.FC<{
  toggleReaction: (reaction: string) => void;
  setThread: () => void;
  toggleEmojiSelector: () => void;
  editMessage: () => void;
  deleteMessage: () => void;
  openMessageReactionsList: () => void;
  editable?: boolean;
  deletable?: boolean;
  isThread: boolean;
  isMoreActionVisible: boolean;
  setIsMoreActionVisible: (isMoreActionVisible: boolean) => void;
  popupPosition: ElementPosition;
}> = ({
  toggleReaction,
  setThread,
  toggleEmojiSelector,
  editMessage,
  deleteMessage,
  openMessageReactionsList,
  editable = false,
  deletable = false,
  isThread,
  isMoreActionVisible,
  setIsMoreActionVisible,
  popupPosition,
}) => {
  const toggleMoreAction = () => {
    setIsMoreActionVisible(!isMoreActionVisible);
  };

  const moreActionArray = [
    {
      name: "Reactions",
      icon: <EmojiWinkIcon />,
      onClick: openMessageReactionsList,
    },
  ];

  if (editable) {
    moreActionArray.push({
      name: "Edit message",
      icon: <EditMessageIcon />,
      onClick: editMessage,
    });
  }
  if (deletable) {
    moreActionArray.push({
      name: "Delete message",
      icon: <TrashIcon />,
      onClick: deleteMessage,
    });
  }

  const actionsArray = [
    {
      icon: <EmojiWinkIcon />,
      onClick: toggleEmojiSelector,
    },
    {
      icon: <ChatTextIcon />,
      onClick: () => setThread(),
    },
    {
      icon: <ThreeDotsIcon />,
      onClick: toggleMoreAction,
    },
  ];

  const ThreadActionsArray = [
    {
      icon: <EmojiWinkIcon />,
      onClick: toggleEmojiSelector,
    },
    {
      icon: <ThreeDotsIcon />,
      onClick: toggleMoreAction,
    },
  ];

  return (
    <div style={styles} onMouseLeave={() => setIsMoreActionVisible(false)}>
      {isMoreActionVisible && (
        <MoreActionContainer
          style={
            popupPosition === ElementPosition.TOP
              ? { bottom: "100%" }
              : { top: "100%" }
          }
        >
          {moreActionArray.map((action, id) => (
            <ActionContainer key={id} onClick={action.onClick}>
              <span style={{ fontSize: "14px" }}>{action.name}</span>
            </ActionContainer>
          ))}
        </MoreActionContainer>
      )}
      {reactionsArray?.map((reaction, id) => (
        <EmojiContainer
          onClick={() => toggleReaction(reaction.emoji)}
          key={"reaction" + id}
        >
          {reaction.icon}
        </EmojiContainer>
      ))}
      {(isThread ? ThreadActionsArray : actionsArray).map((action, id) => (
        <EmojiContainer
          key={"action" + id}
          onClick={action.onClick}
        >
          {action.icon}
        </EmojiContainer>
      ))}
    </div>
  );
};

export default ActionsPopup;
