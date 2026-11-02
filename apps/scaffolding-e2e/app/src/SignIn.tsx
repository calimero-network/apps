import { useState } from "react";
import type { SessionApi } from "./session";

/** Passkey sign-in, or a new account with a new passkey. */
export function SignIn({ api, where }: { api: SessionApi; where: string }) {
  const [name, setName] = useState("");
  return (
    <div className="method-card" style={{ marginBottom: 16 }}>
      <div className="method-name">Sign in</div>
      <p className="method-hint" style={{ marginBottom: 14 }}>
        Connected to {where}. Accounts are passkeys: nothing to remember, nothing to leak.
      </p>
      <div className="input-row">
        <button className="btn-calimero" disabled={api.busy} onClick={() => void api.signIn()}>
          Sign in with a passkey
        </button>
      </div>
      <form
        className="input-row"
        style={{ marginTop: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void api.signUp(name.trim());
        }}
      >
        <input className="form-control"
          placeholder="your name"
          aria-label="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn-calimero-outline" type="submit" disabled={api.busy || !name.trim()}>
          Create an account
        </button>
      </form>
      {api.error && <pre className="result-box error">{api.error}</pre>}
    </div>
  );
}
