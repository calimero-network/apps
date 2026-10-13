import React, { useState } from 'react';
import styled from 'styled-components';
import { tokens as t } from '../theme';
import { describeError } from '../utils/errors';

interface Props {
  placeholder: string;
  submitLabel: string;
  testId: string;
  onSubmit: (value: string) => Promise<unknown>;
  onCancel?: () => void;
  autoFocus?: boolean;
  initial?: string;
  /** Override the derived `${testId}-input` / `${testId}-submit` ids. */
  inputTestId?: string;
  submitTestId?: string;
}

/** A one-field form: Enter submits, Escape cancels, errors show inline. */
export default function InlineForm({ placeholder, submitLabel, testId, onSubmit, onCancel, autoFocus = true, initial = '', inputTestId, submitTestId }: Props): React.ReactElement {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(v);
      setValue('');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <input
        data-testid={inputTestId ?? `${testId}-input`}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel?.(); }}
      />
      <div className="row">
        <button type="submit" className="primary" data-testid={submitTestId ?? `${testId}-submit`} disabled={busy || !value.trim()}>{submitLabel}</button>
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>Cancel</button>}
      </div>
      {error && <p className="err" data-testid={`${testId}-error`}>{error}</p>}
    </Form>
  );
}

const Form = styled.form`
  display: flex; flex-direction: column; gap: 8px;
  input {
    background: ${t.color.panel}; color: ${t.color.text}; border: 1px solid ${t.color.border};
    border-radius: ${t.radius}; padding: 8px 10px; font-size: 13px;
    &:focus { outline: none; border-color: ${t.color.accent}; }
  }
  .row { display: flex; gap: 8px; }
  .primary { background: ${t.color.accent}; color: ${t.color.onAccent}; border: 0; border-radius: ${t.radius}; padding: 7px 12px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .primary:disabled { opacity: .5; cursor: default; }
  .ghost { background: transparent; color: ${t.color.text2}; border: 0; padding: 7px 8px; cursor: pointer; font-size: 12.5px; }
  .err { margin: 0; font-size: 12px; color: ${t.color.danger}; }
`;
