import { styled } from "styled-components";
import Loader from "../loader/Loader";
import { useState } from "react";
import BaseModal from "../common/popups/BaseModal";
import { Button, Input, Radio, RadioGroup } from "@calimero-network/mero-ui";

const Text = styled.div`
  display: flex;
  column-gap: 0.5rem;
  align-items: center;
  color: #fff;
  font-family: Helvetica Neue;
  font-size: 16px;
  font-style: normal;
  font-weight: 500;
  line-height: 120%
  margin-bottom: 0.75rem;
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
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%; /* 18px */
  margin-top: 6px;
`;

const EmptyMessageContainer = styled.div`
  height: 27px;
`;

const IconSvg = styled.svg`
  position: absolute;
  top: 50%;
  right: 13px;
`;

const ExclamationIcon = () => (
  <IconSvg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    fill="#dc3545"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M8.99951 2.74918C5.54773 2.74918 2.74951 5.5474 2.74951 8.99918C2.74951 12.451 5.54773 15.2492 8.99951 15.2492C12.4513 15.2492 15.2495 12.451 15.2495 8.99918C15.2495 5.5474 12.4513 2.74918 8.99951 2.74918ZM1.74951 8.99918C1.74951 4.99511 4.99545 1.74918 8.99951 1.74918C13.0036 1.74918 16.2495 4.99511 16.2495 8.99918C16.2495 13.0032 13.0036 16.2492 8.99951 16.2492C4.99545 16.2492 1.74951 13.0032 1.74951 8.99918ZM8.334 5.058C8.42856 4.95669 8.56093 4.89918 8.69951 4.89918H9.29951C9.4381 4.89918 9.57046 4.95669 9.66503 5.058C9.75959 5.15931 9.80786 5.29532 9.79833 5.43358L9.49833 9.78358C9.48025 10.0457 9.2623 10.2492 8.99951 10.2492C8.73672 10.2492 8.51878 10.0457 8.5007 9.78358L8.2007 5.43358C8.19116 5.29532 8.23944 5.15931 8.334 5.058ZM9.89951 12.2992C9.89951 12.7962 9.49657 13.1992 8.99951 13.1992C8.50246 13.1992 8.09951 12.7962 8.09951 12.2992C8.09951 11.8021 8.50246 11.3992 8.99951 11.3992C9.49657 11.3992 9.89951 11.8021 9.89951 12.2992Z"
      fill="#DC3545"
    />
  </IconSvg>
);

const Container = styled.div`
  position: relative;
  background-color: #1d1d21;
  padding: 0.5rem;
  border-radius: 6px;
  width: 100%;
  height: 100%;
`;

const FormLabel = styled.label`
  font-size: 12px;
  font-weight: 500;
  color: #fff;
  margin-bottom: 0.25rem;
  display: block;
`;

const InputWrapper = styled.div`
  position: relative;
  margin-top: 0.5rem;
`;

interface CreateChannelPopupProps {
  title: string;
  toggle: React.ReactNode;
  placeholder: string;
  createChannel: (
    channelName: string,
    isPublic: boolean,
    isReadOnly: boolean
  ) => Promise<void>;
  buttonText: string;
  channelNameValidator: (value: string) => { isValid: boolean; error: string };
  inputValue: string;
  setInputValue: (value: string) => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export default function CreateChannelPopup({
  title,
  toggle,
  placeholder,
  isOpen,
  setIsOpen,
  createChannel,
  buttonText,
  channelNameValidator,
  inputValue,
  setInputValue,
}: CreateChannelPopupProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [validInput, setValidInput] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [readOnly, setReadOnly] = useState("no");

  const runProcess = async () => {
    setIsProcessing(true);
    await createChannel(
      inputValue,
      visibility === "public",
      readOnly === "yes"
    );
    setInputValue("");
    setIsProcessing(false);
    setIsOpen(false);
  };

  const handleClosePopup = () => {
    if (isProcessing) return;
    setIsOpen(false);
  };


  const isInvalid = !!(inputValue && !validInput && errorMessage);

  const popupContent = (
    <Container>
      <CloseButton onClick={handleClosePopup}>
        <i className="bi bi-x-lg"></i>
      </CloseButton>
      <Text>{title}</Text>
      <InputWrapper>
        <Input
          onChange={(e) => {
            setInputValue(e.target.value);
            if (channelNameValidator) {
              const { isValid, error } = channelNameValidator(e.target.value);
              setValidInput(isValid);
              setErrorMessage(error ? error : "");
            }
          }}
          value={inputValue}
          placeholder={placeholder}
          disabled={isProcessing}
          style={isInvalid ? customStyle : {}}
        />
        {isInvalid && <ExclamationIcon />}
      </InputWrapper>
      {isInvalid ? (
        <ErrorWrapper>{errorMessage}</ErrorWrapper>
      ) : (
        <EmptyMessageContainer />
      )}
      <div style={{ marginBottom: "0.5rem" }}>
        <FormLabel>Visibility:</FormLabel>
        <div className="d-flex">
          <RadioGroup
            value={visibility}
            onChange={setVisibility}
            name="visibility"
            style={{ display: "flex", flexDirection: "row", gap: "0.5rem" }}
          >
            <Radio label="Public" value="public" />
            <Radio label="Private" value="private" />
          </RadioGroup>
        </div>
      </div>

      <div style={{ marginBottom: "0.5rem" }}>
        <FormLabel>Read-only:</FormLabel>
        <div className="d-flex">
          <RadioGroup
            value={readOnly}
            onChange={setReadOnly}
            name="readOnly"
            style={{ display: "flex", flexDirection: "row", gap: "0.5rem" }}
          >
            <Radio label="Yes" value="yes" />
            <Radio label="No" value="no" />
          </RadioGroup>
        </div>
      </div>
      <Button
        onClick={runProcess}
        disabled={inputValue.length > 0 ? isInvalid : true}
        style={{ width: "100%" }}
      >
        {isProcessing ? <Loader size={16} /> : buttonText}
      </Button>
    </Container>
  );

  return (
    <BaseModal
      toggle={toggle}
      content={popupContent}
      open={isOpen}
      onOpenChange={setIsOpen}
    />
  );
}
