import { useEffect, useMemo, useRef, useState, memo } from "react";
import BaseModal from "../common/popups/BaseModal";
import Loader from "../loader/Loader";
import { styled } from "styled-components";
import { usePersistentState } from "../../hooks/usePersistentState";
import { Button, Input } from "@calimero-network/mero-ui";

// ─── Animations ────────────────────────────────────────────────────────────────



// ─── Layout ────────────────────────────────────────────────────────────────────

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 0.875rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
`;

const TitleGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 0.625rem;
`;

const TitleIcon = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: rgba(165, 255, 17, 0.1);
  border: 1px solid rgba(165, 255, 17, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const Title = styled.h2`
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  letter-spacing: 0.01em;
`;

const CloseButton = styled.button`
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.3);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s ease;
  flex-shrink: 0;
  padding: 0;

  &:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }
`;

// ─── Form ──────────────────────────────────────────────────────────────────────

const Field = styled.div`
  margin-bottom: 1.1rem;
`;

const Label = styled.div`
  font-size: 0.68rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.35);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 0.5rem;
`;

const InputWrapper = styled.div`
  position: relative;
`;

const FieldError = styled.p`
  color: #ff6b6b;
  font-size: 0.72rem;
  margin: 0.3rem 0 0;
`;

// ─── Suggestions ───────────────────────────────────────────────────────────────

const SuggestionsDropdown = styled.div`
  max-height: 200px;
  overflow-y: auto;
  border-radius: 10px;
  background: #18181b;
  border: 1px solid rgba(255, 255, 255, 0.08);
  position: absolute;
  top: calc(100% + 4px);
  width: 100%;
  z-index: 100;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);

  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
`;

const SuggestionItem = styled.div`
  padding: 0.6rem 0.875rem;
  cursor: pointer;
  transition: background 0.12s ease;
  display: flex;
  flex-direction: column;
  gap: 2px;

  &:first-child { border-radius: 9px 9px 0 0; }
  &:last-child  { border-radius: 0 0 9px 9px; }
  &:only-child  { border-radius: 9px; }

  &:hover { background: rgba(255, 255, 255, 0.05); }
`;

const SuggestionName = styled.div`
  font-size: 0.82rem;
  font-weight: 600;
  color: #fff;
`;


// ─── Types ─────────────────────────────────────────────────────────────────────

interface MemberSuggestion {
  identity: string;
  label: string;
}

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
  onOpen?: () => Promise<void> | void;
}

// ─── Component ─────────────────────────────────────────────────────────────────

const StartDMPopup = memo(function StartDMPopup({
  title,
  toggle,
  placeholder,
  buttonText,
  validator,
  functionLoader,
  chatMembers,
  onOpen,
}: StartDMPopupProps) {
  const [isOpen, setIsOpen] = usePersistentState("startDMPopupOpen", false);
  const [isProcessing, setIsProcessing] = useState(false);
  // Synchronous re-entrancy guard. `isProcessing` state lags by a render
  // tick, so a fast double-click can fire two onClicks before the first
  // setIsProcessing(true) commits. A ref reflects writes immediately and
  // closes the race.
  const inFlightRef = useRef(false);
  const [inputValue, setInputValue] = usePersistentState("startDMInputValue", "");
  const [selectedIdentity, setSelectedIdentity] = useState("");
  const [validInput, setValidInput] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [suggestions, setSuggestions] = useState<MemberSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const inputRef = useRef("");
  const isInvalid = inputValue && !validInput && errorMessage;

  useEffect(() => { inputRef.current = inputValue; }, [inputValue]);

  const memberOptions = useMemo(
    () => Array.from(chatMembers.entries()).map(([identity, label]) => ({ identity, label })),
    [chatMembers],
  );

  useEffect(() => {
    if (!isOpen) { setShowSuggestions(false); return; }
    if (!inputValue.trim()) {
      setSuggestions(memberOptions);
      setShowSuggestions(memberOptions.length > 0);
    }
  }, [inputValue, isOpen, memberOptions]);

  const updateValidation = (value: string) => {
    if (validator) {
      const { isValid, error } = validator(value.trim());
      setValidInput(isValid);
      setErrorMessage(error || "");
    }
  };

  const filterSuggestions = (value: string) => {
    const q = value.trim().toLowerCase();
    if (!q) return memberOptions;
    return memberOptions.filter(
      ({ identity, label }) =>
        identity.toLowerCase().includes(q) || label.toLowerCase().includes(q),
    );
  };

  const runProcess = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsProcessing(true);
    setErrorMessage("");
    const identity = selectedIdentity || inputValue.trim();
    try {
      const result = await functionLoader(identity);
      if (result.data) {
        setInputValue("");
        setSelectedIdentity("");
        setIsOpen(false);
      } else {
        setErrorMessage(result.error);
      }
    } finally {
      setIsProcessing(false);
      inFlightRef.current = false;
    }
  };

  const handleClose = () => { if (!isProcessing) setIsOpen(false); };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setSelectedIdentity("");
    setErrorMessage("");
    const filtered = filterSuggestions(value);
    setSuggestions(filtered);
    setShowSuggestions(filtered.length > 0);
    updateValidation(value);
  };

  const handleSuggestionClick = (s: MemberSuggestion) => {
    setSelectedIdentity(s.identity);
    updateValidation(s.identity);
    // Only ever show the human-readable label in the visible input. The
    // identity hash stays internal (selectedIdentity), used as the actual
    // target for the DM. If the member has no label yet, leave the input
    // empty rather than dumping the public key into the UI.
    setInputValue(s.label || "");
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const popupContent = (
    <div style={{ pointerEvents: "auto" }}>
      <Header>
        <TitleGroup>
          <TitleIcon>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a5ff11" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
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
        <Label>Member</Label>
        <InputWrapper>
          <Input
            value={inputValue}
            placeholder={placeholder}
            onChange={handleInputChange}
            style={isInvalid ? { border: "1px solid #ff6b6b", outline: "none" } : {}}
          />
          {showSuggestions && suggestions.length > 0 && (
            <SuggestionsDropdown>
              {suggestions.map((s) => (
                <SuggestionItem key={s.identity} onClick={() => handleSuggestionClick(s)}>
                  <SuggestionName>{s.label}</SuggestionName>
                </SuggestionItem>
              ))}
            </SuggestionsDropdown>
          )}
        </InputWrapper>
        {isInvalid && <FieldError>{errorMessage}</FieldError>}
      </Field>

      <Button
        type="button"
        variant="primary"
        style={{ width: "100%", marginTop: "0.25rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
        onClick={() => void runProcess()}
        disabled={isProcessing || (inputValue ? !!isInvalid : true)}
      >
        {isProcessing ? <Loader size={16} /> : buttonText}
      </Button>
    </div>
  );

  return (
    <BaseModal
      toggle={toggle}
      content={popupContent}
      open={isOpen}
      onOpenChange={(open) => {
        if (!isProcessing && open) {
          setIsOpen(open);
          if (onOpen) void onOpen();
        }
      }}
      isChild={true}
    />
  );
});

export default StartDMPopup;
