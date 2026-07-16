import React, { useState } from 'react';
import styled from 'styled-components';
import { tokens as t, PRIORITIES } from '../theme';
import { APP_DISPLAY_NAME } from '../config';

interface Props {
  onCreate: (title: string, description: string, priority: string, labels: string[]) => Promise<void>;
  onClose: () => void;
}

/**
 * New-issue modal with the four required sections (Summary / Impact / Repro /
 * Resolution criteria). Until the backend schema splits `description` (Task
 * 4/5) the four sections are concatenated into the single `description` field.
 */
export default function NewIssueModal({ onCreate, onClose }: Props): React.ReactElement {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [impact, setImpact] = useState('');
  const [repro, setRepro] = useState('');
  const [resolution, setResolution] = useState('');
  const [priority, setPriority] = useState('high');
  const [labels, setLabels] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const valid = [title, summary, impact, repro, resolution].every((v) => v.trim());

  const submit = async () => {
    if (!valid || submitting) return;
    // TODO(phase1-wiring): backend still stores one `description`; concatenate the
    // four sections until Task 4/5 splits the schema into summary/impact/repro/…
    const description = [
      `Summary\n${summary.trim()}`,
      `Impact\n${impact.trim()}`,
      `Repro\n${repro.trim()}`,
      `Resolution criteria\n${resolution.trim()}`,
    ].join('\n\n');
    const parsedLabels = labels.split(',').map((l) => l.trim()).filter(Boolean);
    setSubmitting(true);
    try {
      await onCreate(title.trim(), description, priority, parsedLabels);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Overlay onClick={onClose}>
      <Modal onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="New issue">
        <Head>
          <h3>New issue</h3>
          <span className="ws-tag"><span className="dot" />{APP_DISPLAY_NAME}</span>
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </Head>
        <Body>
          <Field>
            <input
              className="title-input"
              data-testid="field-title"
              placeholder="Issue title"
              aria-label="Issue title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Section eyebrow="Summary" required>
            <textarea
              className="ftext"
              data-testid="field-description"
              placeholder="What is broken, in one paragraph"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </Section>
          <Section eyebrow="Impact" required>
            <textarea
              className="ftext"
              placeholder="Who/what does it affect, why does severity matter"
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
            />
          </Section>
          <Section eyebrow="Repro" required>
            <textarea
              className="ftext mono-field"
              placeholder="Numbered steps and/or paste logs"
              value={repro}
              onChange={(e) => setRepro(e.target.value)}
            />
          </Section>
          <Section eyebrow="Resolution criteria" required>
            <textarea
              className="ftext"
              placeholder="What does fixed mean? The agent will validate against this"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            />
          </Section>
          <Grid2>
            <Section eyebrow="Priority">
              <select
                className="finput"
                data-testid="field-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Section>
            <Section eyebrow="Labels">
              <input
                className="finput"
                data-testid="field-labels"
                placeholder="sync, crdt…"
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
              />
            </Section>
          </Grid2>
        </Body>
        <Foot>
          <span className="note">All four sections are required - issues filed via MCP follow the same format.</span>
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button
            className="primary"
            data-testid="action-create_issue"
            disabled={!valid || submitting}
            onClick={submit}
          >Create issue</button>
        </Foot>
      </Modal>
    </Overlay>
  );
}

function Section({ eyebrow, required, children }: { eyebrow: string; required?: boolean; children: React.ReactNode }) {
  return (
    <FieldWrap>
      <label className="eyebrow">{eyebrow}{required && <span className="req" aria-hidden="true">●</span>}</label>
      {children}
    </FieldWrap>
  );
}

const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 50;
  background: rgba(6,7,9,0.6);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 64px 20px; overflow-y: auto;
`;
const Modal = styled.div`
  width: 640px; max-width: 100%;
  background: ${t.color.panel}; border: 1px solid ${t.color.borderStrong};
  border-radius: ${t.radiusModal};
  box-shadow: 0 20px 60px rgba(0,0,0,0.55), 0 4px 14px rgba(0,0,0,0.4);
  display: flex; flex-direction: column;
  animation: modalin 150ms ease-out;
  @keyframes modalin { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;
const Head = styled.div`
  display: flex; align-items: center; gap: 10px;
  padding: 15px 18px; border-bottom: 1px solid ${t.color.border};
  h3 { font-size: 14px; font-weight: 600; margin: 0; }
  .ws-tag { font-size: 11.5px; color: ${t.color.text2}; display: flex; align-items: center; gap: 6px; }
  .ws-tag .dot { width: 6px; height: 6px; border-radius: 50%; background: ${t.color.accent}; }
  .close {
    margin-left: auto; background: none; border: none; color: ${t.color.text3};
    font-size: 18px; line-height: 1; padding: 2px 6px; border-radius: 4px;
    &:hover { color: ${t.color.text}; background: rgba(255,255,255,0.05); }
  }
`;
const Body = styled.div`padding: 16px 18px; display: flex; flex-direction: column; gap: 16px;`;
const FieldWrap = styled.div`
  display: flex; flex-direction: column; gap: 6px;
  .eyebrow {
    font-size: 11px; letter-spacing: 0.07em; text-transform: uppercase;
    color: ${t.color.text3}; font-weight: 600;
    display: flex; align-items: center; gap: 6px;
  }
  .req { color: ${t.color.accent}; font-size: 10px; }
  .ftext, .finput {
    background: ${t.color.raised}; border: 1px solid ${t.color.border};
    border-radius: ${t.radius}; padding: 9px 11px; color: ${t.color.text};
    font-family: inherit; font-size: 13px; outline: none; resize: vertical; width: 100%;
    transition: border-color 150ms ease-out;
    &::placeholder { color: ${t.color.text3}; }
    &:focus { border-color: ${t.color.accentBorder}; }
  }
  .ftext { min-height: 62px; line-height: 1.5; }
  .mono-field { font-family: ${t.font.mono}; font-size: 12px; min-height: 92px; }
  select.finput { cursor: pointer; text-transform: capitalize; }
`;
const Field = styled(FieldWrap)`
  .title-input {
    background: none; border: none; outline: none;
    font-size: 17px; font-weight: 600; color: ${t.color.text};
    font-family: inherit; padding: 2px 0; letter-spacing: -0.01em;
    &::placeholder { color: ${t.color.text3}; }
  }
`;
const Grid2 = styled.div`display: grid; grid-template-columns: 1fr 1fr; gap: 16px;`;
const Foot = styled.div`
  display: flex; align-items: center; gap: 12px;
  padding: 14px 18px; border-top: 1px solid ${t.color.border};
  .note { font-size: 11.5px; color: ${t.color.text3}; max-width: 340px; line-height: 1.4; }
  .spacer { flex: 1; }
  button { border-radius: ${t.radius}; font-size: 12.5px; font-weight: 500; padding: 6px 11px; border: 1px solid ${t.color.border}; }
  .ghost { background: none; color: ${t.color.text}; &:hover { background: rgba(255,255,255,0.05); } }
  .primary {
    background: ${t.color.accent}; color: ${t.color.onAccent}; border-color: transparent; font-weight: 600;
    &:hover:not(:disabled) { background: #b6ff5e; }
    &:disabled { opacity: 0.5; cursor: default; }
  }
`;
