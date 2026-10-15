import React, { useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { tokens as t, PRIORITIES } from '../theme';
import { SelectMenu } from './Dropdown';
import { IconRepo } from './icons';

interface Props {
  onCreate: (
    title: string,
    summary: string,
    impact: string,
    repro: string,
    resolutionCriteria: string,
    priority: string,
    labels: string[],
  ) => Promise<void>;
  onClose: () => void;
  /** The repository the issue is filed in, named in the header. */
  repoName?: string | null;
}

/**
 * New-issue modal with the four required sections (Summary / Impact / Repro /
 * Resolution criteria), each stored as its own field.
 */
export default function NewIssueModal({ onCreate, onClose, repoName }: Props): React.ReactElement {
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
    const parsedLabels = labels.split(',').map((l) => l.trim()).filter(Boolean);
    setSubmitting(true);
    try {
      await onCreate(
        title.trim(),
        summary.trim(),
        impact.trim(),
        repro.trim(),
        resolution.trim(),
        priority,
        parsedLabels,
      );
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
          {repoName && <span className="ws-tag" title="Filed in this repository"><IconRepo />{repoName}</span>}
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
              data-testid="field-impact"
              placeholder="Who/what does it affect, why does severity matter"
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
            />
          </Section>
          <Section eyebrow="Repro" required>
            <textarea
              className="ftext mono-field"
              data-testid="field-repro"
              placeholder="Numbered steps and/or paste logs"
              value={repro}
              onChange={(e) => setRepro(e.target.value)}
            />
          </Section>
          <Section eyebrow="Resolution criteria" required>
            <textarea
              className="ftext"
              data-testid="field-resolution_criteria"
              placeholder="What does fixed mean? The agent will validate against this"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            />
          </Section>
          <Grid2>
            <Section eyebrow="Priority">
              <SelectMenu
                className="ctl cap"
                testId="field-priority"
                ariaLabel="Priority"
                value={priority}
                options={PRIORITIES}
                onChange={setPriority}
              />
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
          <span className="note">All four sections are required. Issues filed through MCP follow the same format.</span>
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

const fadeIn = keyframes`from{opacity:0;}to{opacity:1;}`;
const pop = keyframes`from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}`;

const Overlay = styled.div`
  position: fixed; inset: 0; z-index: 50;
  background: ${t.color.scrim};
  /* The overlay is fixed itself and holds only its dialog, so this blur
     cannot trap anything. */
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 56px 20px; overflow-y: auto;
  animation: ${fadeIn} 0.15s ease both;
  @media (max-width: 720px) { padding: 10px; }
`;
const Modal = styled.div`
  width: 680px; max-width: 100%;
  background: ${t.color.panel}; border: 1px solid ${t.color.edge};
  border-radius: ${t.radiusModal};
  box-shadow: ${t.shadowFloat};
  display: flex; flex-direction: column;
  animation: ${pop} 0.18s ease both;
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;
const Head = styled.div`
  display: flex; align-items: center; gap: 10px;
  padding: 20px 22px 6px;
  h3 { font-size: 20px; font-weight: 700; letter-spacing: -0.03em; margin: 0; }
  .ws-tag {
    display: inline-flex; align-items: center; gap: 6px; min-width: 0;
    font-size: 12px; font-weight: 600; color: ${t.color.text2};
    padding: 3px 10px 3px 8px; border-radius: ${t.radiusPill}; background: ${t.color.raised2};
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    svg { color: ${t.color.text3}; flex: 0 0 auto; }
  }
  .close {
    margin-left: auto; width: 32px; height: 32px; display: grid; place-items: center; flex: 0 0 auto;
    background: none; border: none; color: ${t.color.text3}; cursor: pointer;
    font-size: 20px; line-height: 1; border-radius: ${t.radiusPill};
    &:hover { color: ${t.color.text}; background: ${t.color.hover}; }
  }
`;
const Body = styled.div`
  padding: 10px 22px 18px; display: flex; flex-direction: column; gap: 14px;
  @media (max-width: 720px) { padding: 8px 16px 16px; }
`;
const FieldWrap = styled.div`
  display: flex; flex-direction: column; gap: 7px;
  .eyebrow {
    font-size: 12px; font-weight: 650; color: ${t.color.text2};
    display: flex; align-items: center; gap: 6px;
  }
  .req { color: ${t.color.accentText}; font-size: 7px; }
  .ftext, .finput {
    background: ${t.color.raised}; border: 1px solid ${t.color.borderStrong};
    border-radius: 14px; padding: 10px 13px; color: ${t.color.text};
    font-family: inherit; font-size: 13.5px; outline: none; resize: vertical; width: 100%;
    transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
    &::placeholder { color: ${t.color.text3}; }
    &:focus { border-color: ${t.color.accentBorder}; box-shadow: 0 0 0 3px ${t.focus}; }
  }
  .finput { min-height: 40px; }
  .ftext { min-height: 66px; line-height: 1.5; }
  .mono-field { font-family: ${t.font.mono}; font-size: 12.5px; min-height: 92px; background: ${t.color.logBg}; }
  .ctl { display: flex; width: 100%; }
  .ctl > button { min-height: 40px; padding: 0 13px; font-size: 13.5px; border-radius: 14px; border-color: ${t.color.borderStrong}; }
  .cap .tv, .cap [role="option"] { text-transform: capitalize; }
`;
const Field = styled(FieldWrap)`
  .title-input {
    background: none; border: none; outline: none;
    font-size: 19px; font-weight: 650; color: ${t.color.text};
    font-family: inherit; padding: 6px 0 8px; letter-spacing: -0.02em;
    border-bottom: 1px solid ${t.color.border};
    &::placeholder { color: ${t.color.text3}; }
    &:focus { border-bottom-color: ${t.color.accentBorder}; }
  }
`;
const Grid2 = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
  @media (max-width: 520px) { grid-template-columns: 1fr; }
`;
const Foot = styled.div`
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 14px 22px 18px; border-top: 1px solid ${t.color.border};
  .note { font-size: 12px; color: ${t.color.text3}; max-width: 340px; line-height: 1.45; flex: 1 1 220px; }
  .spacer { flex: 0 0 0; }
  button {
    font-family: inherit; border-radius: ${t.radiusPill}; font-size: 13.5px; font-weight: 600;
    min-height: 40px; padding: 0 18px; border: 1px solid ${t.color.borderStrong}; cursor: pointer;
  }
  .ghost { background: ${t.color.raised}; color: ${t.color.text}; margin-left: auto; &:hover { background: ${t.color.hover}; } }
  .primary {
    background: ${t.color.accent}; color: ${t.color.onAccent}; border-color: transparent; font-weight: 650;
    box-shadow: 0 10px 24px -12px rgba(14, 18, 34, 0.6);
    &:hover:not(:disabled) { background: ${t.color.accentHover}; }
    &:disabled { opacity: 0.4; cursor: default; box-shadow: none; }
  }
  @media (max-width: 720px) {
    padding: 12px 16px 16px;
    .note { flex-basis: 100%; max-width: none; }
    .ghost { margin-left: 0; }
    .ghost, .primary { flex: 1 1 0; }
  }
`;
