import { useState } from "react";
import { styled } from "styled-components";

import type { SessionApi } from "../calimero/session";
import LandingPage from "./landing/LandingPage";

export const Card = styled.div`
  width: min(420px, 92vw);
  padding: 28px;
  border-radius: 20px;
  background: var(--glass-surface-solid, #fff);
  color: var(--glass-ink, #1b1b1f);
  box-shadow: var(--chat-dialog-shadow);
  display: flex;
  flex-direction: column;
  gap: 14px;

  h2 {
    margin: 0;
    font-size: 20px;
  }
  p {
    margin: 0;
    opacity: 0.75;
    font-size: 14px;
  }
  input {
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid rgba(127, 127, 127, 0.35);
    background: transparent;
    color: inherit;
    font-size: 15px;
  }
  button {
    padding: 10px 14px;
    border-radius: 10px;
    border: none;
    background: var(--glass-accent, #5a5ae6);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }
  button.ghost {
    background: transparent;
    color: inherit;
    border: 1px solid rgba(127, 127, 127, 0.35);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .err {
    color: var(--glass-bad-ink, #c0392b);
    white-space: pre-wrap;
    font-size: 13px;
    margin: 0;
  }
`;

export const Center = styled.div`
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--chat-scrim);
  backdrop-filter: blur(10px);
`;

/**
 * Passkey sign-in, or a new account with a new passkey: what v1's node login
 * and auth frontend were. Accounts live on the cluster (local nodes in dev,
 * Calimero Cloud in production).
 */
export function SignInCard({ api, where, onClose }: { api: SessionApi; where: string; onClose?: () => void }) {
  const [name, setName] = useState("");
  return (
    <Card role="dialog" aria-label="Sign in">
      <h2>Sign in to Mero Chat</h2>
      <p>Connected to {where}. Your account is a passkey: nothing to remember, nothing to leak.</p>
      <button disabled={api.busy} onClick={() => void api.signIn()}>
        Sign in with a passkey
      </button>
      <form
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void api.signUp(name.trim());
        }}
      >
        <input placeholder="Your name" aria-label="name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="ghost" type="submit" disabled={api.busy || !name.trim()}>
          Create an account
        </button>
      </form>
      {api.error && <pre className="err">{api.error}</pre>}
      {onClose && (
        <button className="ghost" onClick={onClose}>
          Back
        </button>
      )}
    </Card>
  );
}

/** Signed out: the landing page, whose "open" opens the sign-in card. */
export default function SignInPage({ api, where }: { api: SessionApi; where: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <LandingPage onConnect={() => setOpen(true)} />
      {open && (
        <Center>
          <SignInCard api={api} where={where} onClose={() => setOpen(false)} />
        </Center>
      )}
    </>
  );
}
