import { styled, keyframes } from "styled-components";

import { useEffect, useRef, useState } from "react";
import BaseModal from "../common/popups/BaseModal";
import { Button, Input } from "@calimero-network/mero-ui";
import {
  getChannelVisibilityOptionLabel,
  type ChannelVisibilityOption,
} from "../../utils/channelVisibility";

// ─── Animations ────────────────────────────────────────────────────────────────

const spin = keyframes`to { transform: rotate(360deg); }`;

// ─── Layout ────────────────────────────────────────────────────────────────────

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 0.875rem;
  border-bottom: 1px solid color-mix(in srgb, var(--glass-ink) 7%, transparent);
`;

const TitleGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 0.625rem;
`;

const TitleIcon = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--glass-accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--glass-accent) 20%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const Title = styled.h2`
  color: var(--glass-ink);
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  letter-spacing: 0.01em;
`;

const CloseButton = styled.button`
  background: transparent;
  border: none;
  color: color-mix(in srgb, var(--glass-ink) 30%, transparent);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 10px;
  transition: all 0.15s ease;
  flex-shrink: 0;
  padding: 0;

  &:hover {
    color: var(--glass-ink);
    background: color-mix(in srgb, var(--glass-ink) 8%, transparent);
  }
`;

// ─── Form ──────────────────────────────────────────────────────────────────────

const Field = styled.div`
  margin-bottom: 1.1rem;
`;

const Label = styled.div`
  font-size: 0.68rem;
  font-weight: 600;
  color: color-mix(in srgb, var(--glass-ink) 35%, transparent);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 0.5rem;
`;

const InputWrapper = styled.div`
  position: relative;
`;

const FieldError = styled.p`
  color: var(--glass-bad-ink);
  font-size: 0.72rem;
  margin: 0.3rem 0 0;
`;

const OptionRow = styled.div`
  display: flex;
  gap: 0.5rem;
`;

const OptionButton = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: 0.5rem 0.75rem;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid ${({ $active }) =>
    $active ? "color-mix(in srgb, var(--glass-accent) 40%, transparent)" : "color-mix(in srgb, var(--glass-ink) 7%, transparent)"};
  background: ${({ $active }) =>
    $active ? "color-mix(in srgb, var(--glass-accent) 8%, transparent)" : "color-mix(in srgb, var(--glass-ink) 3%, transparent)"};
  color: ${({ $active }) =>
    $active ? "var(--glass-accent)" : "color-mix(in srgb, var(--glass-ink) 45%, transparent)"};
  transition: all 0.15s ease;

  &:hover {
    border-color: ${({ $active }) =>
      $active ? "color-mix(in srgb, var(--glass-accent) 55%, transparent)" : "color-mix(in srgb, var(--glass-ink) 14%, transparent)"};
    background: ${({ $active }) =>
      $active ? "color-mix(in srgb, var(--glass-accent) 12%, transparent)" : "color-mix(in srgb, var(--glass-ink) 5%, transparent)"};
    color: ${({ $active }) => ($active ? "var(--glass-accent)" : "color-mix(in srgb, var(--glass-ink) 65%, transparent)")};
  }
`;

const BtnSpinner = styled.div`
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, var(--glass-accent) 30%, transparent);
  border-top-color: var(--glass-accent);
  border-radius: 50%;
  animation: ${spin} 0.7s linear infinite;
`;

// ─── Types ─────────────────────────────────────────────────────────────────────

interface CreateChannelPopupProps {
  title: string;
  toggle: React.ReactNode;
  placeholder: string;
  createChannel: (
    channelName: string,
    isPublic: boolean,
    isReadOnly: boolean,
  ) => Promise<{ error: string } | void>;
  buttonText: string;
  channelNameValidator: (value: string) => { isValid: boolean; error: string };
  inputValue: string;
  setInputValue: (value: string) => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  defaultVisibility: ChannelVisibilityOption;
}

// ─── Component ─────────────────────────────────────────────────────────────────

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
  defaultVisibility,
}: CreateChannelPopupProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [validInput, setValidInput] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [visibility, setVisibility] = useState<ChannelVisibilityOption>(defaultVisibility);
  // Synchronous re-entrancy guard — closes the React-batching race where
  // two onClicks fire before the first setIsProcessing(true) commits.
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (isOpen) setVisibility(defaultVisibility);
  }, [defaultVisibility, isOpen]);

  const runProcess = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsProcessing(true);
    try {
      const result = await createChannel(inputValue, visibility === "public", false);
      if (result?.error) {
        setErrorMessage(result.error);
        setValidInput(false);
        return;
      }
      setInputValue("");
      setIsOpen(false);
    } finally {
      setIsProcessing(false);
      inFlightRef.current = false;
    }
  };

  const handleClose = () => {
    if (!isProcessing) setIsOpen(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) setIsOpen(newOpen);
    else handleClose();
  };

  const isInvalid = !!(inputValue && !validInput && errorMessage);
  const canSubmit = inputValue.trim().length > 0 && !isInvalid;

  const popupContent = (
    <div style={{ pointerEvents: "auto" }}>
      <Header>
        <TitleGroup>
          <TitleIcon>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--glass-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </TitleIcon>
          <Title>{title}</Title>
        </TitleGroup>
        <CloseButton onClick={handleClose} aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </CloseButton>
      </Header>

      <Field>
        <Label>Channel name</Label>
        <InputWrapper>
          <Input
            value={inputValue}
            placeholder={placeholder}
            disabled={isProcessing}
            onChange={(e) => {
              setInputValue(e.target.value);
              if (channelNameValidator) {
                const { isValid, error } = channelNameValidator(e.target.value);
                setValidInput(isValid);
                setErrorMessage(error || "");
              }
            }}
            style={isInvalid ? { border: "1px solid #ff6b6b", outline: "none" } : {}}
          />
        </InputWrapper>
        {isInvalid && <FieldError>{errorMessage}</FieldError>}
      </Field>

      <Field>
        <Label>Visibility</Label>
        <OptionRow>
          <OptionButton $active={visibility === "public"} onClick={() => setVisibility("public")}>
            {getChannelVisibilityOptionLabel("public")}
          </OptionButton>
          <OptionButton $active={visibility === "private"} onClick={() => setVisibility("private")}>
            {getChannelVisibilityOptionLabel("private")}
          </OptionButton>
        </OptionRow>
      </Field>

      <Button
        type="button"
        variant="primary"
        style={{ width: "100%", marginTop: "0.5rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
        onClick={() => void runProcess()}
        disabled={!canSubmit || isProcessing}
      >
        {isProcessing ? <BtnSpinner /> : buttonText}
      </Button>
    </div>
  );

  return (
    <BaseModal
      toggle={toggle}
      content={popupContent}
      open={isOpen}
      onOpenChange={handleOpenChange}
      isChild={true}
    />
  );
}
