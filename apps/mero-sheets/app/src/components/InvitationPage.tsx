/**
 * What a signed-out visitor sees when they open an invitation link: the
 * invitation itself, as a page, in place of the landing page's hero. Before
 * this they got the generic landing page and had to find "Sign in" to learn
 * they had been invited at all.
 *
 * The body is the sign-in popup's (`SignInPanel`), so the copy and the passkey
 * flow are the same in both. Signing up here joins with the token in the same
 * step, and `InvitationPrompt` opens what it names without asking again.
 * Signing in keeps the token; once the session exists `InvitationPrompt` asks
 * "Join?" straight away, and the route the link pointed at is still the
 * address, because nothing here navigated.
 *
 * "Not now" shows the ordinary landing page and keeps the token, so signing
 * in later from there still offers the join.
 */
import styled from 'styled-components';
import { dialogSurface } from './glass';
import { Secondary, SignInPanel } from './SignInModal';

export default function InvitationPage({ onNotNow }: { onNotNow: () => void }) {
  return (
    <Page>
      <Card role="main" aria-labelledby="invitation-page-title" data-testid="invitation-page">
        <SignInPanel titleId="invitation-page-title" />
        <Secondary type="button" onClick={onNotNow} data-testid="invitation-not-now">
          Not now
        </Secondary>
      </Card>
    </Page>
  );
}

const Page = styled.div`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  box-sizing: border-box;
`;

const Card = styled.div`
  ${dialogSurface}
  width: 100%;
  max-width: 420px;
  padding: 30px 28px 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  h3 { font-size: 20px; margin: 0; }
`;
