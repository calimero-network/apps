import React, { useEffect, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { C } from '../theme';
import { MAX_NAME_LEN, isUsableName, normaliseName } from '../lib/displayName';

/**
 * "What should people call you in here?"
 *
 * Shown once per spreadsheet, the first time you open one under a device that
 * has not named itself in it. Before this, a collaborator was a 64-hex device
 * key: the avatar said "3A", the tooltip said the whole key, and the answer to
 * "who moved that cell" was a string nobody can hold in their head.
 *
 * The name goes to the CONTRACT (`join`), not to localStorage — otherwise the
 * only person who can see it is the one person who already knows it. What the
 * browser remembers is just the SUGGESTION, so the second spreadsheet does not
 * ask again.
 *
 * There IS a way past it. Not because skipping is a good outcome — an unnamed
 * collaborator is the problem this exists to fix — but because `join` is a
 * network write that can fail, and a modal with no exit turns one failed write
 * into an unusable spreadsheet. The escape is deliberately the quiet option.
 */
export default function NicknameModal({
  projectName,
  initialName,
  saving,
  error,
  onSubmit,
  onSkip,
}: {
  /** The spreadsheet being entered, so the question has a subject. */
  projectName: string;
  /** The last name this browser used; "" when there is none. */
  initialName: string;
  saving: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
  /** Dismiss for this session, leaving this device unnamed in the roster. */
  onSkip: () => void;
}) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const valid = isUsableName(name);
  const submit = () => {
    if (valid && !saving) onSubmit(normaliseName(name));
  };

  return (
    <Overlay>
      <Dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="nick-title"
        data-testid="nickname-modal"
      >
        <h3 id="nick-title">What should people call you?</h3>
        <p className="sub">
          Shown next to your cursor and edits in{' '}
          <strong>{projectName}</strong>. Everyone in this spreadsheet sees it.
        </p>

        <Field>
          <label htmlFor="nickname">Your name here</label>
          <input
            id="nickname"
            ref={inputRef}
            data-testid="field-nickname"
            value={name}
            maxLength={MAX_NAME_LEN}
            placeholder="e.g. Ada"
            disabled={saving}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
        </Field>

        {error && <ErrorLine>{error}</ErrorLine>}

        <PrimaryBtn
          onClick={submit}
          disabled={!valid || saving}
          data-testid="action-join"
        >
          {saving ? 'Saving…' : 'Continue'}
        </PrimaryBtn>

        <Skip onClick={onSkip} disabled={saving} data-testid="action-skip-nickname">
          Continue without a name
        </Skip>
      </Dialog>
    </Overlay>
  );
}

const fadeIn = keyframes`from{opacity:0;}to{opacity:1;}`;
const pop = keyframes`from{opacity:0;transform:translateY(10px) scale(0.97);}to{opacity:1;transform:none;}`;

const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 120;
  display: flex; align-items: center; justify-content: center; padding: 20px;
  background: rgba(14,20,15,0.5); backdrop-filter: blur(4px);
  animation: ${fadeIn} 0.18s ease both;
`;

const Dialog = styled.div`
  width: 100%; max-width: 400px;
  background: ${C.paper}; border: 1px solid ${C.line}; border-radius: 18px;
  padding: 28px 26px 24px; box-shadow: 0 40px 90px -40px rgba(14,20,15,0.5);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  animation: ${pop} 0.22s cubic-bezier(0.22,1,0.36,1) both;
  h3 { font-size: 19px; font-weight: 800; letter-spacing: -0.4px; color: ${C.ink}; margin: 0 0 8px; }
  .sub { font-size: 13.5px; line-height: 1.55; color: ${C.muted}; margin: 0; }
  .sub strong { color: ${C.ink}; font-weight: 600; }
`;

const Field = styled.div`
  margin: 20px 0 4px;
  label { display: block; font-size: 12px; font-weight: 600; color: ${C.muted}; margin-bottom: 7px; }
  input {
    width: 100%; box-sizing: border-box; padding: 11px 14px; font-size: 14px;
    color: ${C.ink}; background: ${C.paper2}; border: 1px solid ${C.line};
    border-radius: 11px; outline: none;
    &::placeholder { color: ${C.mutedSoft}; }
    &:focus { border-color: ${C.green}; box-shadow: 0 0 0 3px rgba(164,255,17,0.18); }
    &:disabled { opacity: 0.6; }
  }
`;

const PrimaryBtn = styled.button`
  display: inline-flex; align-items: center; justify-content: center; width: 100%;
  margin-top: 18px; padding: 12px 18px;
  font-size: 13.5px; font-weight: 600; border-radius: 11px; cursor: pointer;
  color: ${C.onAccent}; background: ${C.green}; border: 1px solid #93e60c;
  transition: background 0.18s, transform 0.15s;
  &:hover:not(:disabled) { background: ${C.greenHover}; transform: translateY(-1px); }
  &:disabled { opacity: 0.5; cursor: default; }
`;

const Skip = styled.button`
  display: block; width: 100%; margin-top: 8px; padding: 8px;
  font-size: 12.5px; color: ${C.mutedSoft};
  background: transparent; border: none; cursor: pointer;
  &:hover:not(:disabled) { color: ${C.muted}; }
  &:disabled { opacity: 0.5; cursor: default; }
`;

const ErrorLine = styled.p`margin: 12px 0 0; font-size: 12.5px; color: ${C.danger};`;
