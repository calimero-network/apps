import React, { useState } from 'react';
import styled from 'styled-components';
import { useMero } from '@calimero-network/mero-react';
import { C } from '../../theme';
import { APP_DISPLAY_NAME } from '../../config';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useItems } from '../../hooks/useItems';
import { describeError } from '../../utils/errors';
import InviteModal from '../../components/InviteModal';
import JoinModal from '../../components/JoinModal';

/**
 * Neutral single-context CRUD view — the foundation's "app" screen.
 *
 * BUILD AGENT: this is the canonical data-binding shell. Reshape it to the
 * spec's entity:
 *  - `useItems` → your domain hook over the generated `ServiceClient`,
 *  - the form fields + list rows → your entity's fields,
 *  - the page copy → your product.
 * Keep the structure: workspace resolution (bootstrap / join), the item form,
 * the live list, and the Invite/Join wiring — these make it multi-user out of
 * the box. Do NOT reintroduce chat concepts (rooms, messages, presence).
 */
export default function AppPage() {
  const { logout } = useMero();
  const ws = useWorkspace();
  const items = useItems({
    contextId: ws.contextId,
    executorPublicKey: ws.executorPublicKey,
  });

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await items.add(title.trim(), body.trim());
    setTitle('');
    setBody('');
  };

  // No workspace yet (fresh web session): offer create-or-join.
  if (!ws.ready && !ws.loading) {
    return (
      <Empty>
        <Card>
          <h2>Welcome to {APP_DISPLAY_NAME}</h2>
          <p>Create a workspace to start, or join one you were invited to.</p>
          <Row>
            <Primary onClick={() => ws.bootstrap()}>Create workspace</Primary>
            <Secondary onClick={() => setShowJoin(true)}>Join with invitation</Secondary>
          </Row>
          {ws.error && <ErrLine>{describeError(ws.error)}</ErrLine>}
        </Card>
        {showJoin && (
          <JoinModal
            onJoin={async (code) => { await ws.join(code); setShowJoin(false); }}
            onClose={() => setShowJoin(false)}
          />
        )}
      </Empty>
    );
  }

  return (
    <Page>
      <Bar>
        <h1>{APP_DISPLAY_NAME}</h1>
        <div className="actions">
          <Secondary onClick={() => setShowInvite(true)}>Invite</Secondary>
          <Secondary onClick={() => setShowJoin(true)}>Join</Secondary>
          <Secondary onClick={logout}>Sign out</Secondary>
        </div>
      </Bar>

      <Form onSubmit={submit}>
        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          placeholder="Details (optional)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <Primary type="submit" disabled={!title.trim() || !items.ready}>Add</Primary>
      </Form>

      {items.error && <ErrLine>{describeError(items.error)}</ErrLine>}

      <List>
        {items.items.length === 0 && !items.loading && (
          <Hint>No items yet — add the first one above.</Hint>
        )}
        {items.items.map((item) => (
          <ItemRow key={item.id}>
            <div className="text">
              <strong>{item.title}</strong>
              {item.body && <span>{item.body}</span>}
            </div>
            <button onClick={() => items.remove(item.id)} aria-label="Delete">×</button>
          </ItemRow>
        ))}
      </List>

      {showInvite && (
        <InviteModal onInvite={ws.invite} onClose={() => setShowInvite(false)} />
      )}
      {showJoin && (
        <JoinModal
          onJoin={async (code) => { await ws.join(code); setShowJoin(false); }}
          onClose={() => setShowJoin(false)}
        />
      )}
    </Page>
  );
}

const Page = styled.div`
  max-width: 720px;
  margin: 0 auto;
  padding: 28px 20px 64px;
  width: 100%;
`;
const Bar = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
  h1 { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: ${C.ink}; }
  .actions { display: flex; gap: 8px; }
`;
const Form = styled.form`
  display: flex;
  gap: 8px;
  margin-bottom: 22px;
  flex-wrap: wrap;
  input {
    flex: 1; min-width: 160px;
    padding: 10px 12px; font-size: 14px;
    color: ${C.ink}; background: ${C.paper2};
    border: 1px solid ${C.line}; border-radius: 10px; outline: none;
    &:focus { border-color: ${C.green}; box-shadow: 0 0 0 3px rgba(164,255,17,0.18); }
  }
`;
const List = styled.div`display: flex; flex-direction: column; gap: 10px;`;
const ItemRow = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 16px; background: ${C.paper2};
  border: 1px solid ${C.line}; border-radius: 12px;
  .text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .text strong { font-size: 15px; color: ${C.ink}; }
  .text span { font-size: 13px; color: ${C.muted}; }
  button {
    flex-shrink: 0; width: 30px; height: 30px; font-size: 20px; line-height: 1;
    color: ${C.mutedSoft}; background: transparent; border: none; border-radius: 8px; cursor: pointer;
    &:hover { background: ${C.paper}; color: ${C.danger}; }
  }
`;
const Hint = styled.p`font-size: 14px; color: ${C.muted}; padding: 8px 2px;`;
const ErrLine = styled.p`margin: 8px 0; font-size: 13px; color: ${C.danger};`;

const Empty = styled.div`
  flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px;
`;
const Card = styled.div`
  max-width: 420px; text-align: center;
  padding: 32px 28px; background: ${C.paper2};
  border: 1px solid ${C.line}; border-radius: 18px;
  h2 { font-size: 20px; font-weight: 800; letter-spacing: -0.4px; color: ${C.ink}; margin-bottom: 8px; }
  p { font-size: 14px; color: ${C.muted}; margin-bottom: 22px; line-height: 1.55; }
`;
const Row = styled.div`display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;`;

const Primary = styled.button`
  display: inline-flex; align-items: center; justify-content: center;
  padding: 10px 18px; font-size: 13.5px; font-weight: 600; border-radius: 10px; cursor: pointer;
  color: ${C.onAccent}; background: ${C.green}; border: 1px solid #93e60c;
  transition: background 0.18s, transform 0.15s;
  &:hover:not(:disabled) { background: ${C.greenHover}; transform: translateY(-1px); }
  &:disabled { opacity: 0.55; cursor: default; }
`;
const Secondary = styled.button`
  padding: 10px 16px; font-size: 13.5px; font-weight: 600; border-radius: 10px; cursor: pointer;
  color: ${C.ink}; background: ${C.paper}; border: 1px solid ${C.line};
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: ${C.paper2}; border-color: ${C.green}; }
`;
