import React from 'react';
import styled from 'styled-components';

import { tokens as t } from '../theme';
import { useSessionApi } from '../sessionContext';
import SignInPanel from './SignInPanel';
import { Dialog } from './modalKit';

const Page = styled.main`
  min-height: 100dvh; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center; padding: 20px;
  background: ${t.color.bg};
`;
const Card = styled(Dialog)`
  animation: none;
`;
const Later = styled.button`
  display: block; margin: 18px auto 0; padding: 6px 10px;
  font-family: inherit; font-size: 13px; color: ${t.color.text2};
  background: transparent; border: none; border-radius: ${t.radius}; cursor: pointer;
  &:hover:not(:disabled) { color: ${t.color.text}; text-decoration: underline; }
  &:disabled { opacity: 0.6; cursor: default; }
`;

/**
 * What an invite link opened while signed out lands on: the invitation itself,
 * as a page, instead of the landing hero with the invite hidden behind a
 * button. The content is the sign-in popup's (`SignInPanel`), so signing in or
 * creating an account here is the same passkey flow; once a session exists the
 * join prompt (`InvitationHost`) takes over. "Not now" goes to the landing
 * page and keeps the token, so the invite is still waiting at the next sign-in.
 */
export default function InvitationPage({ onNotNow }: { onNotNow: () => void }): React.ReactElement {
  const { api } = useSessionApi();
  return (
    <Page data-testid="invitation-page">
      <Card role="region" aria-labelledby="invitation-page-title">
        <SignInPanel invited titleId="invitation-page-title" />
        <Later type="button" data-testid="invitation-not-now" onClick={onNotNow} disabled={api.busy}>
          Not now
        </Later>
      </Card>
    </Page>
  );
}
