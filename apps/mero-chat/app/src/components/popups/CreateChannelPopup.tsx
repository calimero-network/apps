import { styled } from "styled-components";
import Loader from "../loader/Loader";
import { useState } from "react";

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

const Input = styled.input`
  color: #fff;
  width: 100%;
  height: 40px;
  padding: 8px 60px 8px 16px;
  margin-top: 1rem;
  outline: none;
  border: none;
  border-radius: 4px;
  background-color: #0e0e10;
`;

const customStyle = {
  border: "1px solid #dc3545",
  outline: "none",
};

const FunctionButton = styled.button<{
  $isDisabled?: boolean;
  $colors?: { base: string; hover: string; disabled: string };
}>`
  background-color: ${({ $isDisabled, $colors }) =>
    $isDisabled ? `${$colors?.disabled};` : `${$colors?.base};`};
  :hover {
    background-color: ${({ $isDisabled, $colors }) =>
      $isDisabled ? `${$colors?.disabled};` : `${$colors?.hover};`};
  }
  color: #fff;
  border-radius: 4px;
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
  border: none;
  width: 100%;
`;

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

const Wrapper = styled.div`
  @media (min-width: 1025px) {
    left: 0px;
    right: 0px;
    bottom: 0px;
    top: 0px;
    position: absolute;
    width: 100%;
    height: 100%;
    z-index: 20;
    display: flex;
    background-color: rgba(0, 0, 0, 0.5);
    justify-content: center;
    align-items: center;
  }

  @media (max-width: 1024px) {
    position: absolute;
    z-index: 20;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100vh;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    background-color: rgba(0, 0, 0, 0.5);
  }
`;

const Container = styled.div`
  position: relative;
  background-color: #1d1d21;
  padding: 1rem;
  border-radius: 8px;
  width: 540px;
  @media (max-width: 1024px) {
    width: calc(100% - 2rem);
    max-width: calc(100vw - 2rem);
    position: absolute;
    left: 50%;
    top: 20%;
    transform: translate(-50%, -20%);
    background-color: #1d1d21;
    height: fit-content;
    box-sizing: border-box;
  }
  outline: none;
  &:focus {
    outline: none;
  }
  &:focus-visible {
    outline: none;
  }
`;

const InputWrapper = styled.div`
  position: relative;
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
  colors?: { base: string; hover: string; disabled: string };
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
  colors,
}: CreateChannelPopupProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [validInput, setValidInput] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [readOnly, setReadOnly] = useState("no");

  const runProcess = async () => {
    setIsProcessing(true);
    await createChannel(inputValue, visibility === "public", readOnly === "yes");
    setInputValue("");
    setIsProcessing(false);
    setIsOpen(false);
  };

  const handleClosePopup = () => {
    if (isProcessing) return;
    setIsOpen(false);
  };

  const isInvalid =
    !!(inputValue && !validInput && errorMessage);
  return (
    <>
      {isOpen && (
        <Wrapper>
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
                    const { isValid, error } = channelNameValidator(
                      e.target.value
                    );
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
            <div className="mb-3">
              <label className="form-label">Visibility:</label>
              <div className="d-flex">
                <div className="form-check form-check-inline">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="visibility"
                    id="public"
                    value="public"
                    checked={visibility === "public"}
                    onChange={() => setVisibility("public")}
                  />
                  <label className="form-check-label" htmlFor="public">
                    Public
                  </label>
                </div>
                <div className="form-check form-check-inline">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="visibility"
                    id="private"
                    value="private"
                    checked={visibility === "private"}
                    onChange={() => setVisibility("private")}
                  />
                  <label className="form-check-label" htmlFor="private">
                    Private
                  </label>
                </div>
              </div>
            </div>

            <div className="mb-3">
              <label className="form-label">Read-only:</label>
              <div className="d-flex">
                <div className="form-check form-check-inline">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="readOnly"
                    id="yes"
                    value="yes"
                    checked={readOnly === "yes"}
                    onChange={() => setReadOnly("yes")}
                  />
                  <label className="form-check-label" htmlFor="yes">
                    Yes
                  </label>
                </div>
                <div className="form-check form-check-inline">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="readOnly"
                    id="no"
                    value="no"
                    checked={readOnly === "no"}
                    onChange={() => setReadOnly("no")}
                  />
                  <label className="form-check-label" htmlFor="no">
                    No
                  </label>
                </div>
              </div>
            </div>

            <FunctionButton
              onClick={runProcess}
              $isDisabled={inputValue ? isInvalid : true}
              $colors={colors}
            >
              {isProcessing ? <Loader size={16} /> : buttonText}
            </FunctionButton>
          </Container>
        </Wrapper>
      )}
      <>{toggle}</>
    </>
  );
}
