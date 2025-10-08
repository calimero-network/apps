import { useEffect, useRef, useState, memo } from "react";
import BaseModal from "../common/popups/BaseModal";
import Loader from "../loader/Loader";
import { styled } from "styled-components";
import type { UserId } from "../../api/clientApi";
import { usePersistentState } from "../../hooks/usePersistentState";
import { Button, Input } from "@calimero-network/mero-ui";

const SuggestionsDropdown = styled.div`
  max-height: 200px;
  overflow-y: auto;
  border-radius: 4px;
  background-color: #0e0e10;
  position: absolute;
  top: 100%;
  width: 100%;
  z-index: 10;
`;

const SuggestionItem = styled.div`
  padding: 8px 16px;
  color: #fff;
  cursor: pointer;
  &:hover {
    background-color: #1f1f21;
  }
`;

const Text = styled.div`
  display: flex;
  column-gap: 0.5rem;
  align-items: center;
  color: #fff;
  font-family: Helvetica Neue;
  font-size: 24px;
  font-style: normal;
  font-weight: 500;
  line-height: 120%
  margin-bottom: 1rem;
`;

const customStyle = {
  border: "1px solid #dc3545",
  outline: "none",
};

const CloseButton = styled.div`
  color: #fff;
  :hover {
    color: #5765f2;
  }
  position: absolute;
  right: 1rem;
  cursor: pointer;
`;

const ErrorWrapper = styled.div`
  color: #dc3545;
  /* Body/Small */
  font-family: Helvetica Neue;
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 21px */
  margin-top: 6px;
`;

const EmptyMessageContainer = styled.div`
  height: 27px;
`;

// const IconSvg = styled.svg`
//   position: absolute;
//   top: 50%;
//   right: 13px;
// `;

// const CreationError = styled.div`
//   color: #dc3545;
//   font-size: 14px;
//   font-weight: 400;
//   line-height: 150%;
//   padding-top: 4px;
// `;

// const ExclamationIcon = () => (
//   <IconSvg
//     width="18"
//     height="18"
//     viewBox="0 0 18 18"
//     fill="#dc3545"
//     xmlns="http://www.w3.org/2000/svg"
//   >
//     <path
//       fillRule="evenodd"
//       clipRule="evenodd"
//       d="M8.99951 2.74918C5.54773 2.74918 2.74951 5.5474 2.74951 8.99918C2.74951 12.451 5.54773 15.2492 8.99951 15.2492C12.4513 15.2492 15.2495 12.451 15.2495 8.99918C15.2495 5.5474 12.4513 2.74918 8.99951 2.74918ZM1.74951 8.99918C1.74951 4.99511 4.99545 1.74918 8.99951 1.74918C13.0036 1.74918 16.2495 4.99511 16.2495 8.99918C16.2495 13.0032 13.0036 16.2492 8.99951 16.2492C4.99545 16.2492 1.74951 13.0032 1.74951 8.99918ZM8.334 5.058C8.42856 4.95669 8.56093 4.89918 8.69951 4.89918H9.29951C9.4381 4.89918 9.57046 4.95669 9.66503 5.058C9.75959 5.15931 9.80786 5.29532 9.79833 5.43358L9.49833 9.78358C9.48025 10.0457 9.2623 10.2492 8.99951 10.2492C8.73672 10.2492 8.51878 10.0457 8.5007 9.78358L8.2007 5.43358C8.19116 5.29532 8.23944 5.15931 8.334 5.058ZM9.89951 12.2992C9.89951 12.7962 9.49657 13.1992 8.99951 13.1992C8.50246 13.1992 8.09951 12.7962 8.09951 12.2992C8.09951 11.8021 8.50246 11.3992 8.99951 11.3992C9.49657 11.3992 9.89951 11.8021 9.89951 12.2992Z"
//       fill="#DC3545"
//     />
//   </IconSvg>
// );

const InputWrapper = styled.div`
  position: relative;
  margin-top: 1rem;
`;

export interface CreateContextResult {
  data: string;
  error: string;
}

interface StartDMPopupProps {
    title: string;
    toggle: React.ReactNode;
    placeholder: string;
    buttonText: string;
    validator: (value: string) => { isValid: boolean; error: string };
    functionLoader: (value: string) => Promise<CreateContextResult>;
    chatMembers: Map<string, string>;
}

const StartDMPopup = memo(function StartDMPopup({
    title,
    toggle,
    placeholder,
    buttonText,
    validator,
    functionLoader,
    chatMembers,
  }: StartDMPopupProps) {
  const [isOpen, setIsOpen] = usePersistentState('startDMPopupOpen', false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputValue, setInputValue] = usePersistentState('startDMInputValue', "");
  const [validInput, setValidInput] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [suggestions, setSuggestions] = useState<UserId[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const inputRef = useRef("");

  const isInvalid = inputValue && !validInput && errorMessage;

  useEffect(() => {
    inputRef.current = inputValue;
  }, [inputValue]);

  const runProcess = async() => {
    setIsProcessing(true);
    setErrorMessage("");
    // inputValue is the username -> identity here
    // @ts-expect-error - chatMembers is a Map<string, string>
    const identity = Object.keys(chatMembers).find((key) => chatMembers[key] === inputValue);
    if (!identity) {
      setErrorMessage("User not found");
      setIsProcessing(false);
      return;
    }
    const result = await functionLoader(identity);
    if (result.data) {
      setIsProcessing(false);
      setInputValue(""); // Clear input on success
      setIsOpen(false);
    } else {
      setErrorMessage(result.error);
      setIsProcessing(false);
    }
  };

  const onOpenChange = (isOpen: boolean) => {
    if (isProcessing && !isOpen) {
      return;
    }
    setIsOpen(isOpen);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setErrorMessage("");
    if (value.length > 0) {
      const s = Object.values(chatMembers).filter((member) => member.toLowerCase().startsWith(value.toLowerCase()));
      setSuggestions(s);
      setShowSuggestions(s.length > 0);
    } else {
      setShowSuggestions(false);
      setSuggestions([]);
    }

    if (validator) {
      const { isValid, error } = validator(value);
      setValidInput(isValid);
      setErrorMessage(error ? error : "");
    }

  };

  const handleClosePopup = () => {
    if (isProcessing) return;
    setIsOpen(false);
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (validator) {
      const { isValid, error } = validator(suggestion);
      setValidInput(isValid);
      setErrorMessage(error ? error : "");
    }
    setInputValue(suggestion);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const popupContent = (
    <>
      <CloseButton onClick={handleClosePopup}>
        <i className="bi bi-x-lg"></i>
      </CloseButton>
      <Text>{title}</Text>
      <InputWrapper>
        <Input
          onChange={handleInputChange}
          value={inputValue}
          placeholder={placeholder}
          style={isInvalid ? customStyle : {}}
        />
        {/* {errorMessage && <CreationError>{errorMessage}</CreationError>} */}
        {/* {isInvalid && <ExclamationIcon />} */}
        {showSuggestions && suggestions && suggestions.length > 0 && (
        <SuggestionsDropdown>
          {suggestions.map((suggestion, index) => (
            <SuggestionItem
              key={index}
              onClick={() => handleSuggestionClick(suggestion)}
            >
              {suggestion}
            </SuggestionItem>
          ))}
        </SuggestionsDropdown>
      )}
      </InputWrapper>
      {isInvalid ? (
        <ErrorWrapper>{errorMessage}</ErrorWrapper>
      ) : (
        <EmptyMessageContainer />
      )}
      <Button
        onClick={runProcess}
        disabled={inputValue ? !!isInvalid : true}
        style={{ width: "100%" }}
      >
        {isProcessing ? <Loader size={16} /> : buttonText}
      </Button>
    </>
  );

  return (
    <BaseModal
      toggle={toggle}
      content={popupContent}
      open={isOpen}
      onOpenChange={onOpenChange}
    />
  );
});

export default StartDMPopup;
