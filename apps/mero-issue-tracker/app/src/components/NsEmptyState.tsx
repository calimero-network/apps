import React from 'react';
import styled from 'styled-components';
import type { Namespace } from '@calimero-network/mero-react';
import { tokens as t } from '../theme';
import { APP_DISPLAY_NAME } from '../config';
import { LogoMark } from './icons';

interface Props {
  namespaces: Namespace[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  onJoin: () => void;
}

/** Full-pane onboarding shown whenever no namespace is active: the app mark,
 *  a one-line explainer, and the two primary actions. When namespaces already
 *  exist (e.g. a prior explicit choice isn't valid anymore) it also offers a
 *  picker instead of assuming the visitor has none yet. */
export default function NsEmptyState({ namespaces, onSelect, onCreate, onJoin }: Props): React.ReactElement {
  const hasNamespaces = namespaces.length > 0;
  return (
    <Wrap data-testid="ns-empty-state">
      <Panel>
        <span className="mark"><LogoMark /></span>
        <h1>Welcome to {APP_DISPLAY_NAME}</h1>
        {hasNamespaces ? (
          <>
            <p>Select a workspace to continue, create a new one, or join one you were invited to.</p>
            <select
              className="pick"
              data-testid="ns-empty-select"
              aria-label="Select a workspace"
              defaultValue=""
              onChange={(e) => { if (e.target.value) onSelect(e.target.value); }}
            >
              <option value="" disabled>Select a workspace</option>
              {namespaces.map((n) => (
                <option key={n.namespaceId} value={n.namespaceId}>
                  {n.name || n.namespaceId.slice(0, 8)}
                </option>
              ))}
            </select>
          </>
        ) : (
          <p>Create a team workspace to start tracking repositories and issues, or join one you were invited to.</p>
        )}
        <div className="row">
          <button className="primary" data-testid="ns-create-btn" onClick={onCreate}>Create workspace</button>
          <button className="secondary" data-testid="ns-join-btn" onClick={onJoin}>Join workspace</button>
        </div>
      </Panel>
    </Wrap>
  );
}

const Wrap = styled.div`
  flex: 1; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  padding: 24px; background: ${t.color.bg}; color: ${t.color.text}; font-family: ${t.font.sans};
`;
const Panel = styled.div`
  max-width: 440px; text-align: center;
  padding: 40px 32px; background: ${t.color.panel};
  border: 1px solid ${t.color.border}; border-radius: 14px;
  .mark {
    display: inline-grid; place-items: center; width: 46px; height: 46px; margin-bottom: 18px;
    border-radius: 12px; background: ${t.color.accentDim}; border: 1px solid ${t.color.accentBorder};
    color: ${t.color.accent};
  }
  h1 { font-size: 21px; font-weight: 600; letter-spacing: -0.02em; margin: 0 0 10px; }
  p { font-size: 13.5px; color: ${t.color.text2}; margin: 0 0 26px; line-height: 1.6; }
  .pick {
    width: 100%; margin: -12px 0 26px; padding: 10px 12px; border-radius: ${t.radius};
    background: ${t.color.raised}; border: 1px solid ${t.color.border}; color: ${t.color.text};
    font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
    option { background: ${t.color.panel}; color: ${t.color.text}; }
  }
  .row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
  button { border-radius: ${t.radius}; font-size: 13px; font-weight: 600; padding: 11px 18px; cursor: pointer; }
  .primary { background: ${t.color.accent}; color: ${t.color.onAccent}; border: 1px solid transparent; &:hover { background: #b6ff5e; } }
  .secondary { background: ${t.color.raised}; color: ${t.color.text}; border: 1px solid ${t.color.border}; &:hover { background: ${t.color.raised2}; } }
`;
