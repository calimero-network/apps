import { useState } from "react";
import { styled } from "styled-components";

import SignInPanel from "./SignInPanel";

/**
 * What a signed-out visitor sees when they open an invitation link: the
 * invitation itself, as the whole page, with the passkey sign-in on it. No
 * landing hero behind it and no extra click: joining is what they came for.
 * Signing in brings up the join prompt (`InvitationPrompt`) straight away.
 *
 * "Not now" goes on to the ordinary landing page and keeps the token, so
 * signing in later from there still offers the invitation.
 */

const Page = styled.main`
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  box-sizing: border-box;
  background: var(--glass-ground);
`;

const Card = styled.div`
  width: min(420px, 100%);
  box-sizing: border-box;
  padding: 1.5rem;
  border-radius: 20px;
  background: var(--glass-surface-solid);
  border: 1px solid var(--glass-edge);
  box-shadow: var(--glass-shadow-float);
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-top: 1rem;
`;

const NotNow = styled.button`
  padding: 0.5rem 1.1rem;
  border-radius: 10px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid color-mix(in srgb, var(--glass-ink) 10%, transparent);
  background: color-mix(in srgb, var(--glass-ink) 6%, transparent);
  color: var(--glass-ink);
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

interface Props {
  onNotNow: () => void;
  /** Runs before a ceremony starts (the stale-storage purge). */
  beforeCeremony?: () => void;
}

export default function InvitationPage({ onNotNow, beforeCeremony }: Props) {
  const [busy, setBusy] = useState(false);
  return (
    <Page data-testid="invitation-page">
      <Card>
        <SignInPanel
          invited
          beforeCeremony={beforeCeremony}
          onBusy={setBusy}
          testId="invitation-signin"
        />
        <Actions>
          <NotNow
            type="button"
            onClick={onNotNow}
            disabled={busy}
            data-testid="invitation-not-now"
          >
            Not now
          </NotNow>
        </Actions>
      </Card>
    </Page>
  );
}
