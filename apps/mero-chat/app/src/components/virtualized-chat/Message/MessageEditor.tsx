import { useCallback, useRef, useState } from "react";
import styled from "styled-components";

import EmojiSelectorPopup from "../EmojiSelector/EmojiSelectorPopup";
import type { AccountData } from "../types/curbTypes";

import { RichTextEditor } from "@calimero-network/mero-ui";
import {
  ActionsWrapper,
  EditorWrapper,
  FullWidthWrapper,
  IconEmoji,
  IconSendSvg,
} from "../../../chat/MessageInput";
import { emptyText, markdownParser } from "../../../utils/markdownParser";

interface MessageEditorProps {
  text: string;
  onSubmit: (text: string) => void;
  onCancelEdit: () => void;
  deleteMessage: () => void;
  getIconFromCache: (accountId: string) => Promise<string | null>;
  fetchAccounts: (prefix: string) => void;
  autocompleteAccounts: AccountData[];
}

const MessageEditorWrapper = styled.div`
  position: relative;
  @media (min-width: 1025px) {
    padding-left: 32px;
    padding-right: 32px;
    padding-top: 6px;
    padding-bottom: 6px;
  }
  display: flex;
  flex-direction: column;
  gap: 12px;
  .box-wrapper {
    display: flex;
  }
  .inputFieldWrapper {
    position: relative;
    z-index: 10;
    border-radius: 4px;
    padding: 11px 8px;
    background: rgb(17, 17, 17);
    display: flex;
    justify-content: center;
    gap: 4px;
    align-items: end;
    flex: 1;
    @media (min-width: 1025px) {
      padding: 10px 12px;
    }
  }
  .wrapper {
    flex: 1;
  }
  .helperWrapper {
    @media (min-width: 1025px) {
      display: flex;
      gap: 16px;
      justify-content: start;
      align-items: center;
      font-family: Helvetica Neue;
      font-size: 12px;
      font-style: normal;
      font-weight: 400;
      line-height: 150%;
      color: #fff;
    }
    @media (max-width: 1024px) {
      display: none;
    }
  }
  .helperTitle {
    display: flex;
    gap: 4px;
    justify-content: center;
    align-items: center;
  }
  .helperOptions {
    display: flex;
  }
  .option {
    color: #A5FF11;
    cursor: pointer;
    padding-left: 3px;
    padding-right: 3px;
  }
  .ql-editor {
    padding-right: 42px;
    max-height: 228px;
  }
  .svgwrapper,
  .sendIconWrapper {
    position: relative;
    height: 32px;
    width: 32px;
    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;

  .hidden-svg {
    visibility: hidden;
    position: absolute;
    z-index: -10;
  }

  .visible-svg {
    visibility: visible;
  }
  .iconEmoji {
    fill: #686672;
    :hover {
      fill: #ffdd1d;
    }
  }
  .sendIcon {
    @media (min-width: 1025px) {
      display: none;
    }
    width: 1.5rem;
    height: 1.5rem;
  }
  .sendIconWrapper {
    @media (min-width: 1025px) {
      display: none;
    }
  }
`;

const IconFile = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="17"
    viewBox="0 0 16 17"
    fill="white"
  >
    <path
      d="M15.502 2.44247C15.5954 2.53619 15.6479 2.66313 15.6479 2.79547C15.6479 2.92781 15.5954 3.05475 15.502 3.14847L14.459 4.19247L12.459 2.19247L13.502 1.14847C13.5958 1.05473 13.7229 1.00208 13.8555 1.00208C13.9881 1.00208 14.1152 1.05473 14.209 1.14847L15.502 2.44147V2.44247ZM13.752 4.89847L11.752 2.89847L4.939 9.71247C4.88396 9.76749 4.84253 9.83461 4.818 9.90847L4.013 12.3225C3.9984 12.3665 3.99633 12.4137 4.00701 12.4588C4.0177 12.5039 4.04072 12.5452 4.07351 12.578C4.10629 12.6107 4.14755 12.6338 4.19267 12.6445C4.23779 12.6551 4.28499 12.6531 4.329 12.6385L6.743 11.8335C6.81676 11.8092 6.88387 11.7681 6.939 11.7135L13.752 4.89847Z"
      fill="white"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M1 14.0025C1 14.4003 1.15804 14.7818 1.43934 15.0631C1.72064 15.3444 2.10218 15.5025 2.5 15.5025H13.5C13.8978 15.5025 14.2794 15.3444 14.5607 15.0631C14.842 14.7818 15 14.4003 15 14.0025V8.00247C15 7.86986 14.9473 7.74268 14.8536 7.64892C14.7598 7.55515 14.6326 7.50247 14.5 7.50247C14.3674 7.50247 14.2402 7.55515 14.1464 7.64892C14.0527 7.74268 14 7.86986 14 8.00247V14.0025C14 14.1351 13.9473 14.2623 13.8536 14.356C13.7598 14.4498 13.6326 14.5025 13.5 14.5025H2.5C2.36739 14.5025 2.24021 14.4498 2.14645 14.356C2.05268 14.2623 2 14.1351 2 14.0025V3.00247C2 2.86986 2.05268 2.74268 2.14645 2.64892C2.24021 2.55515 2.36739 2.50247 2.5 2.50247H9C9.13261 2.50247 9.25979 2.44979 9.35355 2.35602C9.44732 2.26225 9.5 2.13508 9.5 2.00247C9.5 1.86986 9.44732 1.74268 9.35355 1.64892C9.25979 1.55515 9.13261 1.50247 9 1.50247H2.5C2.10218 1.50247 1.72064 1.6605 1.43934 1.94181C1.15804 2.22311 1 2.60464 1 3.00247V14.0025Z"
      fill="white"
    />
  </svg>
);

interface SendIconProps {
  isActive: boolean;
  onClick: () => void;
}

const SendIcon = ({ isActive, onClick }: SendIconProps) => (
  <IconSendSvg
    onClick={onClick}
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    fill={`${isActive ? "#73B30C" : "#686672"}`}
    className="bi bi-send-fill"
    viewBox="0 0 16 16"
  >
    <path d="M15.964.686a.5.5 0 0 0-.65-.65L.767 5.855H.766l-.452.18a.5.5 0 0 0-.082.887l.41.26.001.002 4.995 3.178 3.178 4.995.002.002.26.41a.5.5 0 0 0 .886-.083l6-15Zm-1.833 1.89L6.637 10.07l-.215-.338a.5.5 0 0 0-.154-.154l-.338-.215 7.494-7.494 1.178-.471-.47 1.178Z" />
  </IconSendSvg>
);

function MessageEditor({
  text,
  onSubmit,
  onCancelEdit,
  deleteMessage,
}: MessageEditorProps) {
  const [inputText, setInputText] = useState(text);
  const [openEmojisPopup, setOpenEmojisPopup] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);

  const INPUT_FIELD_EMPTY_VALUE = "<p><br></p>";

  const updateEditedMessage = (libValue?: string) => {
    const isEmptyContent =
      !libValue ||
      libValue.trim() === "" ||
      libValue === "<p></p>" ||
      libValue === "<p><br></p>" ||
      libValue
        .replace(/<p><\/p>/g, "")
        .replace(/<p><br><\/p>/g, "")
        .trim() === "" ||
      emptyText.test(markdownParser(libValue ?? "", []));

    const updatedValue = libValue ?? inputText;
    if (updatedValue && isEmptyContent) {
      onSubmit(updatedValue);
    } else {
      deleteMessage();
    }
  };

  const handleEmojiSelected = useCallback((emoji: string) => {
    editorRef.current?.insertContent(emoji);
  }, []);

  const handleMessageChange = useCallback((mesage: string | null) => {
    setInputText(mesage ?? "");
  }, []);

  const handleSendMessageEnter = async (content: string) => {
    const isEmptyContent =
      !content ||
      content.trim() === "" ||
      content === "<p></p>" ||
      content === "<p><br></p>" ||
      content
        .replace(/<p><\/p>/g, "")
        .replace(/<p><br><\/p>/g, "")
        .trim() === "" ||
      emptyText.test(markdownParser(content ?? "", []));

    if (isEmptyContent) {
      onSubmit("");
      setOpenEmojisPopup(false);
      handleMessageChange(null);
    } else {
      onSubmit(markdownParser(content ?? "", []));
      setOpenEmojisPopup(false);
      handleMessageChange(null);
    }
  };

  return (
    <MessageEditorWrapper>
      {openEmojisPopup && (
        <EmojiSelectorPopup
          onClose={() => setOpenEmojisPopup(false)}
          onEmojiSelected={handleEmojiSelected}
        />
      )}
      <div className="inputFieldWrapper">
        <div className="wrapper">
          <FullWidthWrapper>
            <EditorWrapper
              style={{
                flex: 1,
                width: "100%",
                minWidth: 0,
              }}
            >
              <RichTextEditor
                ref={editorRef}
                value={inputText}
                sendOnEnter={true}
                clearOnSend={true}
                onChange={(value: string) => setInputText(value)}
                onSend={handleSendMessageEnter}
                placeholder={"Edit message"}
                maxHeight={30}
                style={{ fontSize: "14px" }}
                className="full-width-editor"
              />
            </EditorWrapper>
          </FullWidthWrapper>
        </div>
        <ActionsWrapper>
          <div onClick={() => setOpenEmojisPopup(!openEmojisPopup)}>
            <IconEmoji />
          </div>
          <SendIcon
            onClick={() => updateEditedMessage()}
            isActive={inputText !== INPUT_FIELD_EMPTY_VALUE}
          />
        </ActionsWrapper>
      </div>
      <div className="helperWrapper">
        <IconFile />
        <div className="helperTitle">Editing message</div>
        <div className="helperOptions">
          <span className="option" onClick={onCancelEdit}>
            cancel
          </span>{" "}
          - enter to{" "}
          <span className="option" onClick={() => updateEditedMessage()}>
            save
          </span>
        </div>
      </div>
    </MessageEditorWrapper>
  );
}

export default MessageEditor;
