import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { C } from '../theme';
import { dialogSurface, overlay, primaryPill } from './glass';
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

const Overlay = styled.div`
  ${overlay}
  z-index: 120;
  display: flex; align-items: center; justify-content: center; padding: 20px;
`;

const Dialog = styled.div`
  ${dialogSurface}
  width: 100%; max-width: 400px;
  padding: 30px 28px 26px;
  h3 { font-size: 19px; font-weight: 800; letter-spacing: -0.4px; color: ${C.ink}; margin: 0 0 8px; }
  .sub { font-size: 13.5px; line-height: 1.55; color: ${C.muted}; margin: 0; }
  .sub strong { color: ${C.ink}; font-weight: 600; }
`;

const Field = styled.div`
  margin: 20px 0 4px;
  label { display: block; font-size: 12px; font-weight: 600; color: ${C.muted}; margin-bottom: 7px; }
  input {
    width: 100%; box-sizing: border-box; padding: 11px 14px; font-size: 14px;
    color: ${C.ink}; background: var(--glass-sunken); border: 1px solid var(--glass-line);
    border-radius: 12px; outline: none;
    &::placeholder { color: ${C.mutedSoft}; }
    &:focus { border-color: var(--glass-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--glass-accent-solid) 18%, transparent); }
    &:disabled { opacity: 0.6; }
  }
`;

const PrimaryBtn = styled.button`
  ${primaryPill}
  width: 100%; margin-top: 18px;
`;

const Skip = styled.button`
  display: block; width: 100%; margin-top: 8px; padding: 8px;
  font-size: 12.5px; color: ${C.mutedSoft};
  background: transparent; border: none; cursor: pointer;
  &:hover:not(:disabled) { color: ${C.muted}; }
  &:disabled { opacity: 0.5; cursor: default; }
`;

const ErrorLine = styled.p`margin: 12px 0 0; font-size: 12.5px; color: ${C.danger};`;
