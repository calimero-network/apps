import { useEffect, useState } from "react";
import styled from "styled-components";

import EmojiSelectorPopup from "../EmojiSelector/EmojiSelectorPopup";
import InputField from "../InputField/InputField";
import type { AccountData } from "../types/curbTypes";

import AutocompleteList from "./AutocompleteList";

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
    padding: 10px 6px;
    background: #1d1d21;
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
    color: #5765f2;
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

interface EmojiWinkProps {
  onClick: () => void;
}

const EmojiWink = ({ onClick }: EmojiWinkProps) => {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="svgwrapper"
      onClick={onClick}
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
        fill="#73B30C"
        className={`bi bi-emoji-wink-fill ${
          hovered ? "visible-svg" : "hidden-svg"
        }`}
        viewBox="0 0 16 16"
      >
        <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM7 6.5C7 5.672 6.552 5 6 5s-1 .672-1 1.5S5.448 8 6 8s1-.672 1-1.5zM4.285 9.567a.5.5 0 0 0-.183.683A4.498 4.498 0 0 0 8 12.5a4.5 4.5 0 0 0 3.898-2.25.5.5 0 1 0-.866-.5A3.498 3.498 0 0 1 8 11.5a3.498 3.498 0 0 1-3.032-1.75.5.5 0 0 0-.683-.183zm5.152-3.31a.5.5 0 0 0-.874.486c.33.595.958 1.007 1.687 1.007.73 0 1.356-.412 1.687-1.007a.5.5 0 0 0-.874-.486.934.934 0 0 1-.813.493.934.934 0 0 1-.813-.493z" />
      </svg>
    </div>
  );
};

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
  fill: string;
  onClick: () => void;
}

const SendIcon = ({ fill, onClick }: SendIconProps) => (
  <div className="sendIconWrapper" onClick={onClick}>
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      fill={fill}
      className="sendIcon"
      viewBox="0 0 16 16"
    >
      <path d="M15.964.686a.5.5 0 0 0-.65-.65L.767 5.855H.766l-.452.18a.5.5 0 0 0-.082.887l.41.26.001.002 4.995 3.178 3.178 4.995.002.002.26.41a.5.5 0 0 0 .886-.083l6-15Zm-1.833 1.89L6.637 10.07l-.215-.338a.5.5 0 0 0-.154-.154l-.338-.215 7.494-7.494 1.178-.471-.47 1.178Z" />
    </svg>
  </div>
);

function MessageEditor({
  text,
  onSubmit,
  onCancelEdit,
  deleteMessage,
  getIconFromCache,
  fetchAccounts,
  autocompleteAccounts,
}: MessageEditorProps) {
  const [inputText, setInputText] = useState(text);
  const [openEmojisPopup, setOpenEmojisPopup] = useState(false);
  const [showAutocomplete, setShowAutocomplete] = useState(false);

  const autoCompleteAccountId = (accountId: string) => {
    let tempText = inputText.replace(/[\s]{0,1}@[^\s]*$/, "");
    tempText = `${tempText} @${accountId}`.trim() + " \u200B";
    setInputText(tempText);
    setShowAutocomplete(false);
  };

  useEffect(() => {
    const showAccountAutocomplete = /@[\w][^\s]*$/.test(inputText);
    setShowAutocomplete(showAccountAutocomplete);
  }, [inputText]);

  const INPUT_FIELD_EMPTY_VALUE = "<p><br></p>";

  const updateEditedMessage = (libValue?: string) => {
    const updatedValue = libValue ?? inputText;
    if (updatedValue && updatedValue !== INPUT_FIELD_EMPTY_VALUE) {
      onSubmit(updatedValue);
    } else {
      deleteMessage();
    }
  };

  const updateFieldValue = (emoji: string) => {
    setOpenEmojisPopup(false);
    if (!inputText) {
      setInputText(`<p>${emoji}</p>`);
    }
    const endingsToCheck = [
      "<br>",
      "<br></p>",
      "</p>",
      "</strong>",
      "<br></li></ul>",
      "</li></ul>",
      "</em>",
      "</u>",
      "<br></li></ol>",
      "</li></ol>",
    ];

    for (const ending of endingsToCheck) {
      if (inputText.endsWith(ending)) {
        const lastIndex = inputText.lastIndexOf(ending);
        setInputText(inputText.substring(0, lastIndex) + emoji + ending);
      }
    }
  };

  useEffect(() => {
    const term = inputText.split("@").pop()?.split("<")[0];
    if (term && showAutocomplete) {
      fetchAccounts(term.toLowerCase());
    }
  }, [showAutocomplete, inputText]);

  return (
    <MessageEditorWrapper>
      {openEmojisPopup && (
        <EmojiSelectorPopup
          onClose={() => setOpenEmojisPopup(false)}
          onEmojiSelected={(emoji) => updateFieldValue(emoji)}
        />
      )}
      <div className="inputFieldWrapper">
        {showAutocomplete && autocompleteAccounts.length > 0 && (
          <AutocompleteList
            onSelect={autoCompleteAccountId}
            autocompleteAccounts={autocompleteAccounts}
            getIconFromCache={getIconFromCache}
          />
        )}
        <div className="wrapper">
          <InputField
            value={inputText}
            setValue={setInputText}
            handleMessageSend={updateEditedMessage}
            isEditMode={true}
            discardChanges={onCancelEdit}
          />
        </div>
        <EmojiWink onClick={() => setOpenEmojisPopup(!openEmojisPopup)} />
        <SendIcon
          onClick={() => updateEditedMessage()}
          fill={inputText !== INPUT_FIELD_EMPTY_VALUE ? "#4E95FF" : "#686672"}
        />
      </div>
      <div className="helperWrapper">
        <IconFile />
        <div className="helperTitle">Editing message</div>
        <div className="helperOptions">
          escape to{" "}
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
