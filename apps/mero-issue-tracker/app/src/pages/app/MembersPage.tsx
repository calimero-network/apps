import React from 'react';
import styled from 'styled-components';
import { tokens as t } from '../../theme';
import { truncateKey } from '../../utils/display';
import AvatarGlyph from '../../components/AvatarGlyph';
import { useAppCtx } from './appContext';

/**
 * Workspace members. Rows come from the context identities (public keys only -
 * aliases arrive with Task 6, so the current identity shows "You" and the rest
 * render as truncated keys). Invite opens the existing invitation modal.
 */
export default function MembersPage(): React.ReactElement {
  const { members, currentUser, openInvite } = useAppCtx();

  // Always include the current identity even before getContextIdentities returns.
  const keys = Array.from(new Set([currentUser, ...members].filter(Boolean)));

  return (
    <Wrap>
      <Head>
        <h2>Members</h2>
        <div className="actions">
          {/* TODO(task-6): alias editing - wire to setMemberMetadata once aliases land. */}
          <button className="secondary" disabled title="Coming soon">Set my alias</button>
          <button className="primary" data-testid="open-invite-btn" onClick={openInvite}>Invite</button>
        </div>
      </Head>

      <Table>
        <Row className="head">
          <span>Member</span><span>Public key</span><span>Joined</span><span />
        </Row>
        {keys.map((key) => {
          const you = key === currentUser;
          return (
            <Row key={key}>
              <span className="user">
                <AvatarGlyph seed={key} size="md" keyFallback={!you} />
                <span className={`alias${you ? '' : ' faded'}`}>{you ? 'You' : truncateKey(key)}</span>
              </span>
              <span className="key">{truncateKey(key)}</span>
              <span className="date">-</span>
              <span>{you && <span className="you-badge">You</span>}</span>
            </Row>
          );
        })}
      </Table>
    </Wrap>
  );
}

const Wrap = styled.div`padding: 24px 24px 60px; overflow-y: auto; flex: 1;`;
const Head = styled.div`
  display: flex; align-items: center; margin-bottom: 18px; gap: 8px;
  h2 { font-size: 15px; font-weight: 600; margin: 0; }
  .actions { margin-left: auto; display: flex; gap: 8px; }
  button {
    border-radius: ${t.radius}; font-size: 12.5px; font-weight: 500; padding: 6px 11px;
    border: 1px solid ${t.color.border}; cursor: pointer;
  }
  .secondary { background: ${t.color.raised}; color: ${t.color.text}; &:hover:not(:disabled) { background: ${t.color.raised2}; } &:disabled { opacity: 0.5; cursor: default; } }
  .primary { background: ${t.color.accent}; color: ${t.color.onAccent}; border-color: transparent; font-weight: 600; &:hover { background: #b6ff5e; } }
`;
const Table = styled.div`
  width: 100%; border: 1px solid ${t.color.border}; border-radius: 8px;
  overflow: hidden; background: ${t.color.panel};
`;
const Row = styled.div`
  display: grid; grid-template-columns: 1.4fr 1.6fr 1fr 60px;
  align-items: center; gap: 12px; padding: 11px 16px;
  border-bottom: 1px solid ${t.color.border};
  &:last-child { border-bottom: none; }
  &.head { background: ${t.color.raised}; }
  &.head span { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: ${t.color.text3}; font-weight: 600; }
  .user { display: flex; align-items: center; gap: 10px; }
  .alias { font-size: 13px; font-weight: 500; }
  .alias.faded { color: ${t.color.text3}; font-family: ${t.font.mono}; font-size: 12px; font-weight: 400; }
  .key { font-family: ${t.font.mono}; font-size: 12px; color: ${t.color.text2}; }
  .date { font-size: 12.5px; color: ${t.color.text2}; font-variant-numeric: tabular-nums; }
  .you-badge {
    font-size: 10.5px; color: ${t.color.accent}; border: 1px solid ${t.color.accentBorder};
    background: ${t.color.accentDim}; border-radius: 4px; padding: 1px 6px; font-weight: 600;
  }
`;
