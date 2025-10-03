import { useCallback, useEffect, useState } from "react";
import { styled } from "styled-components";
import type { ChatFile, MessageWithReactions } from "../types/Common";
import EmojiSelector from "../emojiSelector/EmojiSelector";
import { emptyText, markdownParser } from "../utils/markdownParser";
import UploadComponent from "./UploadComponent";
import MessageFileField from "./MessageFileField";
import MessageImageField from "./MessageImageField";
import { MarkdownEditor } from "../markdown/MarkdownEditor";
import type { ResponseData } from "@calimero-network/calimero-client";
import { ClientApiDataSource } from "../api/dataSource/clientApiDataSource";
import { extractUsernames } from "../utils/mentions";
import { RichTextEditor } from "@calimero-network/mero-ui";

// Force full width for the editor
const EditorWrapper = styled.div`
  .full-width-editor {
    width: 100% !important;
    min-width: 0 !important;
    flex: 1 !important;
    max-width: 100% !important;
  }

  .full-width-editor > div {
    width: 100% !important;
    min-width: 0 !important;
  }

  .full-width-editor .ql-editor {
    width: 100% !important;
    min-width: 0 !important;
  }
`;

const Container = styled.div`
  width: 100%;
  padding-left: 16px;
  padding-right: 16px;
  padding-top: 1px;
  padding-bottom: 12px;
  display: flex;
  align-items: end;
  z-index: 10;
  transform: translateZ(0);
  @media (min-width: 1025px) {
    gap: 8px;
    border-radius: 4px;
    /* Prevent layout shifts when modals open on desktop */
    will-change: transform;
    backface-visibility: hidden;
    /* Ensure the element stays in place when modals open */
    isolation: isolate;
  }
  @media (max-width: 1024px) {
    margin: 0 !important;
    border-top-left-radius: 4px;
    border-top-right-radius: 4px;
    gap: 4px;
    margin: 0px;
    padding-left: 8px;
    padding-right: 8px;
    padding-bottom: 12px;
    padding-top: 12px;
    width: 100% !important;
    transform: translateZ(0);
    /* Prevent layout shifts when modals open */
    will-change: transform;
    backface-visibility: hidden;
  }
`;

const EmojiPopupContainer = styled.div`
  position: absolute;
  bottom: 70px;
  right: 2.5rem;
  z-index: 1000;
`;

const UploadPopupContainer = styled.div`
  position: absolute;
  bottom: 46px;
  left: 16px;
  z-index: 1000;
  @media (max-width: 1024px) {
    left: 8px;
  }
`;

const UploadContainer = styled.div`
  background-color: #25252a;
  border-radius: 2px;
  width: fit-content;
`;

const Wrapper = styled.div`
  flex: 1;
  display: flex;
  align-items: start;
  background-color: #111111;
  min-width: 0;
`;

const FullWidthWrapper = styled.div`
  display: flex;
  flex-direction: row;
  overflow: hidden;
  align-items: start;
  width: 100%;
  flex: 1;
  min-width: 0; /* This is crucial for flex items to shrink */
`;

const EmojiContainer = styled.div`
  border-radius: 2px;
  margin-bottom: 4px;
  height: 26px;
  width: 26px;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2px;
  cursor: pointer;

  .hidden-svg {
    visibility: hidden;
    position: absolute;
    z-index: -10;
  }

  .visible-svg {
    visibility: visible;
  }
`;

const IconEmoji = () => {
  const [hovered, setHovered] = useState(false);

  return (
    <EmojiContainer
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        fill="#686672"
        className={`bi bi-emoji-wink ${hovered ? "hidden-svg" : "visible-svg"}`}
        viewBox="0 0 16 16"
      >
        <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z" />
        <path d="M4.285 9.567a.5.5 0 0 1 .683.183A3.498 3.498 0 0 0 8 11.5a3.498 3.498 0 0 0 3.032-1.75.5.5 0 1 1 .866.5A4.498 4.498 0 0 1 8 12.5a4.498 4.498 0 0 1-3.898-2.25.5.5 0 0 1 .183-.683zM7 6.5C7 7.328 6.552 8 6 8s-1-.672-1-1.5S5.448 5 6 5s1 .672 1 1.5zm1.757-.437a.5.5 0 0 1 .68.194.934.934 0 0 0 .813.493c.339 0 .645-.19.813-.493a.5.5 0 1 1 .874.486A1.934 1.934 0 0 1 10.25 7.75c-.73 0-1.356-.412-1.687-1.007a.5.5 0 0 1 .194-.68z" />
      </svg>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        fill="#FFDD1D"
        className={`bi bi-emoji-wink-fill ${
          hovered ? "visible-svg" : "hidden-svg"
        }`}
        viewBox="0 0 16 16"
      >
        <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM7 6.5C7 5.672 6.552 5 6 5s-1 .672-1 1.5S5.448 8 6 8s1-.672 1-1.5zM4.285 9.567a.5.5 0 0 0-.183.683A4.498 4.498 0 0 0 8 12.5a4.5 4.5 0 0 0 3.898-2.25.5.5 0 1 0-.866-.5A3.498 3.498 0 0 1 8 11.5a3.498 3.498 0 0 1-3.032-1.75.5.5 0 0 0-.683-.183zm5.152-3.31a.5.5 0 0 0-.874.486c.33.595.958 1.007 1.687 1.007.73 0 1.356-.412 1.687-1.007a.5.5 0 0 0-.874-.486.934.934 0 0 1-.813.493.934.934 0 0 1-.813-.493z" />
      </svg>
    </EmojiContainer>
  );
};

const IconSendSvg = styled.svg`
  margin-bottom: 8px;
  :hover {
    fill: #4e95ff;
  }
  cursor: pointer;
`;
const IconSend = ({
  onClick,
  isActive,
}: {
  onClick: () => void;
  isActive: boolean;
}) => (
  <IconSendSvg
    onClick={onClick}
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    fill={`${isActive ? "#4E95FF" : "#686672"}`}
    className="bi bi-send-fill"
    viewBox="0 0 16 16"
  >
    <path d="M15.964.686a.5.5 0 0 0-.65-.65L.767 5.855H.766l-.452.18a.5.5 0 0 0-.082.887l.41.26.001.002 4.995 3.178 3.178 4.995.002.002.26.41a.5.5 0 0 0 .886-.083l6-15Zm-1.833 1.89L6.637 10.07l-.215-.338a.5.5 0 0 0-.154-.154l-.338-.215 7.494-7.494 1.178-.471-.47 1.178Z" />
  </IconSendSvg>
);

const Placeholder = styled.div<{
  $placeholderPosition: string;
  $placeholderPositionMobile: string;
}>`
  position: absolute;
  z-index: 10;
  bottom: ${({ $placeholderPosition }) =>
    $placeholderPosition && $placeholderPosition};
  left: 25px;
  color: #686672;
  font-size: 16px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  pointer-events: none;
  @media (max-width: 1024px) {
    font-size: 14px;
    font-style: normal;
    font-weight: 400;
    line-height: 150%;
    bottom: ${({ $placeholderPositionMobile }) =>
      $placeholderPositionMobile && $placeholderPositionMobile};
    left: 14px;
  }

  &.desktop {
    display: block;
  }

  &.mobile {
    display: none;
  }

  @media (max-width: 1024px) {
    &.desktop {
      display: none;
    }

    &.mobile {
      display: block;
    }
  }
`;

const ReadOnlyField = styled.div`
  background-color: #111111;
  height: 2rem;
  border-radius: 4px;
  padding: 4px 8px 4px 8px;
  font-family: Helvetica Neue;
  font-size: 16px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  color: #797978;
  flex: 1;
  @media (max-width: 1024px) {
    font-size: 14px;
    display: flex;
    align-items: center;
  }
`;

const ImageIconSvg = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="#fff"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M15.75 12.75C15.75 13.7446 15.3549 14.6984 14.6517 15.4017C13.9484 16.1049 12.9946 16.5 12 16.5C11.0054 16.5 10.0516 16.1049 9.34835 15.4017C8.64509 14.6984 8.25 13.7446 8.25 12.75C8.25 11.7554 8.64509 10.8016 9.34835 10.0983C10.0516 9.39509 11.0054 9 12 9C12.9946 9 13.9484 9.39509 14.6517 10.0983C15.3549 10.8016 15.75 11.7554 15.75 12.75Z"
      fill="white"
    />
    <path
      d="M3 6C2.20435 6 1.44129 6.31607 0.87868 6.87868C0.316071 7.44129 0 8.20435 0 9V18C0 18.7956 0.316071 19.5587 0.87868 20.1213C1.44129 20.6839 2.20435 21 3 21H21C21.7956 21 22.5587 20.6839 23.1213 20.1213C23.6839 19.5587 24 18.7956 24 18V9C24 8.20435 23.6839 7.44129 23.1213 6.87868C22.5587 6.31607 21.7956 6 21 6H19.242C18.4464 5.99983 17.6835 5.68365 17.121 5.121L15.879 3.879C15.3165 3.31635 14.5536 3.00017 13.758 3H10.242C9.44641 3.00017 8.68348 3.31635 8.121 3.879L6.879 5.121C6.31652 5.68365 5.55358 5.99983 4.758 6H3ZM3.75 9C3.55109 9 3.36032 8.92098 3.21967 8.78033C3.07902 8.63968 3 8.44891 3 8.25C3 8.05109 3.07902 7.86032 3.21967 7.71967C3.36032 7.57902 3.55109 7.5 3.75 7.5C3.94891 7.5 4.13968 7.57902 4.28033 7.71967C4.42098 7.86032 4.5 8.05109 4.5 8.25C4.5 8.44891 4.42098 8.63968 4.28033 8.78033C4.13968 8.92098 3.94891 9 3.75 9ZM17.25 12.75C17.25 14.1424 16.6969 15.4777 15.7123 16.4623C14.7277 17.4469 13.3924 18 12 18C10.6076 18 9.27226 17.4469 8.28769 16.4623C7.30312 15.4777 6.75 14.1424 6.75 12.75C6.75 11.3576 7.30312 10.0223 8.28769 9.03769C9.27226 8.05312 10.6076 7.5 12 7.5C13.3924 7.5 14.7277 8.05312 15.7123 9.03769C16.6969 10.0223 17.25 11.3576 17.25 12.75Z"
      fill="white"
    />
  </svg>
);

const FileIconSvg = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="#fff"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g clipPath="url(#clip0_952_64107)">
      <path
        d="M13.9395 0H6C5.20435 0 4.44129 0.316071 3.87868 0.87868C3.31607 1.44129 3 2.20435 3 3V21C3 21.7956 3.31607 22.5587 3.87868 23.1213C4.44129 23.6839 5.20435 24 6 24H18C18.7956 24 19.5587 23.6839 20.1213 23.1213C20.6839 22.5587 21 21.7956 21 21V7.0605C20.9999 6.66271 20.8418 6.28124 20.5605 6L15 0.4395C14.7188 0.158176 14.3373 8.49561e-05 13.9395 0V0ZM14.25 5.25V2.25L18.75 6.75H15.75C15.3522 6.75 14.9706 6.59196 14.6893 6.31066C14.408 6.02936 14.25 5.64782 14.25 5.25ZM9.75 8.25V9.201L10.5735 8.7255C10.6588 8.67548 10.7532 8.64283 10.8512 8.62943C10.9492 8.61603 11.0489 8.62214 11.1445 8.64743C11.2401 8.67271 11.3298 8.71665 11.4084 8.77674C11.487 8.83682 11.5529 8.91185 11.6023 8.9975C11.6518 9.08316 11.6838 9.17776 11.6966 9.27584C11.7093 9.37393 11.7025 9.47357 11.6766 9.56902C11.6507 9.66447 11.6062 9.75386 11.5456 9.83203C11.4849 9.9102 11.4095 9.97561 11.3235 10.0245L10.5 10.5L11.3235 10.9755C11.4095 11.0244 11.4849 11.0898 11.5456 11.168C11.6062 11.2461 11.6507 11.3355 11.6766 11.431C11.7025 11.5264 11.7093 11.6261 11.6966 11.7242C11.6838 11.8222 11.6518 11.9168 11.6023 12.0025C11.5529 12.0882 11.487 12.1632 11.4084 12.2233C11.3298 12.2833 11.2401 12.3273 11.1445 12.3526C11.0489 12.3779 10.9492 12.384 10.8512 12.3706C10.7532 12.3572 10.6588 12.3245 10.5735 12.2745L9.75 11.799V12.75C9.75 12.9489 9.67098 13.1397 9.53033 13.2803C9.38968 13.421 9.19891 13.5 9 13.5C8.80109 13.5 8.61032 13.421 8.46967 13.2803C8.32902 13.1397 8.25 12.9489 8.25 12.75V11.799L7.4265 12.2745C7.34117 12.3245 7.24679 12.3572 7.14879 12.3706C7.0508 12.384 6.95111 12.3779 6.85549 12.3526C6.75987 12.3273 6.67019 12.2833 6.59162 12.2233C6.51304 12.1632 6.44713 12.0882 6.39768 12.0025C6.34822 11.9168 6.3162 11.8222 6.30345 11.7242C6.2907 11.6261 6.29748 11.5264 6.32339 11.431C6.34931 11.3355 6.39385 11.2461 6.45445 11.168C6.51505 11.0898 6.59052 11.0244 6.6765 10.9755L7.5 10.5L6.6765 10.0245C6.50565 9.92434 6.38134 9.76066 6.33072 9.56919C6.2801 9.37772 6.30727 9.174 6.40629 9.00248C6.50532 8.83096 6.66817 8.70558 6.8593 8.65369C7.05043 8.6018 7.25433 8.62761 7.4265 8.7255L8.25 9.201V8.25C8.25 8.05109 8.32902 7.86032 8.46967 7.71967C8.61032 7.57902 8.80109 7.5 9 7.5C9.19891 7.5 9.38968 7.57902 9.53033 7.71967C9.67098 7.86032 9.75 8.05109 9.75 8.25ZM6.75 15H14.25C14.4489 15 14.6397 15.079 14.7803 15.2197C14.921 15.3603 15 15.5511 15 15.75C15 15.9489 14.921 16.1397 14.7803 16.2803C14.6397 16.421 14.4489 16.5 14.25 16.5H6.75C6.55109 16.5 6.36032 16.421 6.21967 16.2803C6.07902 16.1397 6 15.9489 6 15.75C6 15.5511 6.07902 15.3603 6.21967 15.2197C6.36032 15.079 6.55109 15 6.75 15ZM6.75 18H14.25C14.4489 18 14.6397 18.079 14.7803 18.2197C14.921 18.3603 15 18.5511 15 18.75C15 18.9489 14.921 19.1397 14.7803 19.2803C14.6397 19.421 14.4489 19.5 14.25 19.5H6.75C6.55109 19.5 6.36032 19.421 6.21967 19.2803C6.07902 19.1397 6 18.9489 6 18.75C6 18.5511 6.07902 18.3603 6.21967 18.2197C6.36032 18.079 6.55109 18 6.75 18Z"
        fill="white"
      />
    </g>
    <defs>
      <clipPath id="clip0_952_64107">
        <rect width="24" height="24" fill="white" />
      </clipPath>
    </defs>
  </svg>
);

const ErrorContainer = styled.div`
  position: relative;
  top: 0;
  padding-top: 4px;
  padding-bottom: 4px;
  padding-left: 8px;
  display: flex;
  width: 206px;
  color: #dc3545;
  font-family: Helvetica Neue;
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  background-color: #25252a;
  border-radius: 2px;
`;

const ActionsWrapper = styled.div`
  position: absolute;
  right: 42px;
  bottom: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
`;

interface MessageInputProps {
  selectedChat: string;
  sendMessage: (message: string) => void;
  resetImage: () => void;
  openThread: MessageWithReactions | undefined;
  isThread: boolean;
  isReadOnly: boolean;
  isOwner: boolean;
  isModerator: boolean;
}

export default function MessageInput({
  selectedChat,
  sendMessage,
  resetImage,
  openThread,
  isThread,
  isReadOnly,
  isOwner,
  isModerator,
}: MessageInputProps) {
  const [canWriteMessage, setCanWriteMessage] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [message, setMessage] = useState<MessageWithReactions | null>(null);
  const [uploadedFile, setUploadedFile] = useState<ChatFile | null>(null);
  const [uploadedImage, setUploadedImage] = useState<ChatFile | null>(null);
  const [emojiSelectorOpen, setEmojiSelectorOpen] = useState(false);
  const [selectedEmoji, setSelectedEmoji] = useState("");
  const [error, setError] = useState("");
  const placeholderPosition = "16px";

  const handleMessageChange = useCallback(
    (mesage: MessageWithReactions | null) => {
      setMessage(mesage);
    },
    []
  );

  useEffect(() => {
    setMessage(null);
    setEmojiSelectorOpen(false);
    setSelectedEmoji("");
  }, [selectedChat]);

  const resetFile = useCallback(() => {
    setUploadedFile(null);
    setShowUpload(false);
  }, []);

  const resetImageLocal = useCallback(() => {
    setUploadedImage(null);
    setShowUpload(false);
  }, []);

  const isActive =
    (message && !emptyText.test(markdownParser(message?.text ?? "", []))) ||
    uploadedImage ||
    uploadedFile;

  const handleSendMessage = async () => {
    if (
      (uploadedFile && !uploadedFile.file.cid) ||
      (uploadedImage && !uploadedImage.file.cid)
    ) {
      return;
    } else if (
      emptyText.test(markdownParser(message?.text ?? "", [])) &&
      !uploadedImage &&
      !uploadedFile
    ) {
      handleMessageChange(null);
    } else {
      let tagList: string[] = [];
      const channelUsers: ResponseData<Map<string, string>> =
        await new ClientApiDataSource().getChannelMembers({
          channel: { name: selectedChat },
        });
      if (channelUsers.data) {
        tagList = extractUsernames(channelUsers.data);
      }
      sendMessage(markdownParser(message?.text ?? "", tagList));
      resetImageLocal();
      resetFile();
      setShowUpload(false);
      setEmojiSelectorOpen(false);
      handleMessageChange(null);
    }
  };

  const handleSendMessageEnter = async (content: string) => {
    if (
      emptyText.test(markdownParser(content ?? "", [])) &&
      !uploadedImage &&
      !uploadedFile
    ) {
      handleMessageChange(null);
    } else {
      let tagList: string[] = [];
      const channelUsers: ResponseData<Map<string, string>> =
        await new ClientApiDataSource().getChannelMembers({
          channel: { name: selectedChat },
        });
      if (channelUsers.data) {
        tagList = extractUsernames(channelUsers.data);
      }
      sendMessage(markdownParser(content ?? "", tagList));
      resetImageLocal();
      resetFile();
      setShowUpload(false);
      setEmojiSelectorOpen(false);
      handleMessageChange(null);
    }
  };

  useEffect(() => {
    setCanWriteMessage(false);
    if (isReadOnly) {
      if (isModerator || isOwner) {
        setCanWriteMessage(true);
      } else {
        setCanWriteMessage(false);
      }
    } else {
      setCanWriteMessage(true);
    }
  }, [isReadOnly, isModerator, isOwner]);

  const getCustomStyle = (openThread: boolean, isThread: boolean) => {
    const customStyle = {
      width: "100%",
      maxWidth: "100%",
      boxSizing: "border-box" as const,
    };
    if (openThread && !isThread) {
      customStyle.width = "calc(60% - 262px)";
    } else if (!openThread && !isThread) {
      customStyle.width = "100%";
    } else if (openThread && isThread) {
      customStyle.width = "calc(40% - 212px)";
    }
    return customStyle;
  };
  return (
    // <>
    //   {canWriteMessage && (
    <Container style={getCustomStyle(!!openThread, isThread)}>
      <Wrapper>
        <FullWidthWrapper>
          <EditorWrapper
            style={{
              flex: 1,
              width: "100%",
              minWidth: 0,
            }}
          >
            <RichTextEditor
              placeholder={
                openThread && isThread
                  ? `Reply in thread`
                  : `Type message in ${selectedChat}`
              }
              onChange={(value) => {
                setMessage(
                  message
                    ? { ...message, text: value }
                    : {
                        id: "",
                        text: value,
                        nonce: "",
                        timestamp: Date.now(),
                        sender: "",
                        reactions: new Map(),
                        files: [],
                        images: [],
                        thread_count: 0,
                        thread_last_timestamp: 0,
                      }
                );
              }}
              maxHeight={50}
              className="full-width-editor"
            />
          </EditorWrapper>
          {/* <MarkdownEditor
                setValue={(value) =>
                  setMessage(
                    message
                      ? { ...message, text: value }
                      : {
                          id: "",
                          text: value,
                          nonce: "",
                          timestamp: Date.now(),
                          sender: "",
                          reactions: new Map(),
                          files: [],
                          images: [],
                          thread_count: 0,
                          thread_last_timestamp: 0,
                        }
                  )
                }
                value={message?.text ?? ""}
                selectedEmoji={selectedEmoji}
                resetSelectedEmoji={() => setSelectedEmoji("")}
                handleMessageSent={(content: string) => {
                  handleSendMessageEnter(content);
                }}
              /> */}
        </FullWidthWrapper>
        {/* {(!message ||
              emptyText.test(
                markdownParser(message?.text ?? "", [])
              )) && (
              <>
                <Placeholder
                  $placeholderPosition={placeholderPosition}
                  $placeholderPositionMobile={placeholderPosition}
                  className="desktop"
                >
                  {openThread && isThread
                    ? `Reply in thread`
                    : `Type message in ${selectedChat}`}
                </Placeholder>
                <Placeholder
                  $placeholderPosition={placeholderPosition}
                  $placeholderPositionMobile={placeholderPosition}
                  className="mobile"
                >
                  {openThread && isThread
                    ? `Reply in thread`
                    : `Type message in ${selectedChat.length == 44 ? `${selectedChat.toLowerCase().slice(0, 6)}...${selectedChat.toLowerCase().slice(-4)}` : selectedChat}`}
                </Placeholder>
              </>
            )} */}

        {uploadedFile?.file.cid && (
          <>
            <MessageFileField file={uploadedFile.file} resetFile={resetFile} />
          </>
        )}
        {uploadedImage?.file.cid && (
          <>
            <MessageImageField
              file={uploadedImage.file}
              resetImage={resetImage}
            />
          </>
        )}
      </Wrapper>
      <ActionsWrapper>
        <div onClick={() => setEmojiSelectorOpen(!emojiSelectorOpen)}>
          <IconEmoji />
        </div>
        <IconSend
          onClick={() => {
            if (isActive) {
              handleSendMessage();
            }
          }}
          isActive={!!isActive}
        />
        {emojiSelectorOpen && (
          <EmojiPopupContainer>
            <EmojiSelector
              onEmojiSelected={(emoji) => setSelectedEmoji(emoji)}
            />
          </EmojiPopupContainer>
        )}
      </ActionsWrapper>
      {showUpload && !uploadedFile?.file.cid && !uploadedImage?.file.cid && (
        <UploadPopupContainer>
          {error && <ErrorContainer>{error}</ErrorContainer>}
          <UploadContainer>
            <UploadComponent
              uploadedFile={uploadedImage}
              setUploadedFile={setUploadedImage}
              type={["image/jpeg", "image/png", "image/gif"]}
              icon={<ImageIconSvg />}
              text="Upload Image"
              setError={setError}
              key="images-component"
            />
            <UploadComponent
              uploadedFile={uploadedFile}
              setUploadedFile={setUploadedFile}
              type={["*/*"]}
              icon={<FileIconSvg />}
              text="Upload File"
              setError={setError}
              key="files-component"
            />
          </UploadContainer>
        </UploadPopupContainer>
      )}
    </Container>
    //   )}
    //   {!canWriteMessage && (
    //     <Container style={getCustomStyle(!!openThread, isThread)}>
    //       <ReadOnlyField>
    //         You don&apos;t have permissions to write in this channel
    //       </ReadOnlyField>
    //     </Container>
    //   )}
    // </>
  );
}
