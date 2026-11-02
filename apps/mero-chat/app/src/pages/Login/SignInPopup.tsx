import { useEffect, useState } from "react";
import { styled } from "styled-components";

import BaseModal from "../../components/common/popups/BaseModal";
import { signIn, signUp, useCalimero } from "../../api/calimero";
import { pendingInvite } from "../../utils/invitation";
import { setMessengerDisplayName } from "../../utils/messengerName";

/**
 * Sign in with a passkey, or create an account with a new one. Replaces v1's
 * connect popup (a node URL, node login, the Cloud wallet): on Calimero 1.0
 * the build already names its cluster (`merod local` in dev, the Cloud
 * cluster in production) and an account is a passkey.
 */

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 280px;
`;

const Title = styled.div`
  color: var(--glass-ink);
  font-size: 16px;
  font-weight: 600;
`;

const Hint = styled.div`
  color: color-mix(in srgb, var(--glass-ink) 60%, transparent);
  font-size: 0.84rem;
  line-height: 1.5;
`;

const ErrorText = styled.div`
  color: var(--glass-bad-ink);
  font-size: 0.82rem;
`;

const Divider = styled.div`
  height: 1px;
  background: color-mix(in srgb, var(--glass-ink) 8%, transparent);
  margin: 0.25rem 0;
`;

const Input = styled.input`
  padding: 0.6rem 0.75rem;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--glass-ink) 14%, transparent);
  background: transparent;
  color: var(--glass-ink);
  font-size: 0.88rem;
  outline: none;
  &:focus {
    border-color: color-mix(in srgb, var(--glass-ink) 35%, transparent);
  }
`;

const Button = styled.button<{ $primary?: boolean }>`
  padding: 0.65rem 1rem;
  border-radius: 12px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid
    ${({ $primary }) => ($primary ? "transparent" : "color-mix(in srgb, var(--glass-ink) 12%, transparent)")};
  background: ${({ $primary }) =>
    $primary ? "var(--glass-ink)" : "color-mix(in srgb, var(--glass-ink) 5%, transparent)"};
  color: ${({ $primary }) => ($primary ? "var(--glass-on-ink)" : "var(--glass-ink)")};
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function SignInPopup({ isOpen, onClose }: Props) {
  const { status, message } = useCalimero();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const invited = pendingInvite() !== null;

  useEffect(() => {
    if (isOpen && status === "signed-in") onClose();
  }, [isOpen, status, onClose]);

  const create = async () => {
    const chosen = name.trim();
    await signUp(chosen);
    // The name they chose is the one the workspace picker offers.
    setMessengerDisplayName(chosen);
  };

  const run = async (ceremony: () => Promise<void>) => {
    setBusy(true);
    try {
      await ceremony();
    } catch {
      // `message` carries the reason.
    } finally {
      setBusy(false);
    }
  };

  return (
    <BaseModal
      toggle={<span />}
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      content={
        <Container data-testid="signin-popup">
          <Title>{invited ? "You're invited" : "Sign in to Mero Chat"}</Title>
          <Hint>
            {invited ? "Sign in, or create an account, to join the workspace you were invited to. " : ""}
            Your account is a passkey: nothing to remember, nothing to leak.
          </Hint>

          {status === "connecting" && <Hint>Connecting…</Hint>}
          {status === "unconfigured" && <ErrorText role="alert">{message}</ErrorText>}

          {status === "signed-out" && (
            <>
              <Button $primary disabled={busy} onClick={() => void run(signIn)} data-testid="signin-passkey">
                {busy ? "Waiting for your passkey…" : "Sign in with a passkey"}
              </Button>
              <Divider />
              <Hint>New here? Choose the name people will see.</Hint>
              <Input
                aria-label="Your name"
                placeholder="Your name"
                value={name}
                maxLength={50}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) void run(create);
                }}
                data-testid="signup-name"
              />
              <Button
                disabled={busy || !name.trim()}
                onClick={() => void run(create)}
                data-testid="signup-passkey"
              >
                Create an account
              </Button>
            </>
          )}

          {message && status !== "unconfigured" && <ErrorText role="alert">{message}</ErrorText>}
        </Container>
      }
    />
  );
}
