import { useState } from "react";
import type { SessionApi } from "./session";

/** Passkey sign-in, or a new account with a new passkey. */
export function SignIn({ api, where }: { api: SessionApi; where: string }) {
  const [name, setName] = useState("");
  return (
    <div className="card">
      <h2>Sign in</h2>
      <p className="empty" style={{ marginBottom: 14 }}>
        Connected to {where}. Accounts are passkeys: nothing to remember, nothing to leak.
      </p>
      <div className="row">
        <button disabled={api.busy} onClick={() => void api.signIn()}>
          Sign in with a passkey
        </button>
      </div>
      <form
        className="row"
        style={{ marginTop: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void api.signUp(name.trim());
        }}
      >
        <input
          placeholder="your name"
          aria-label="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="ghost" type="submit" disabled={api.busy || !name.trim()}>
          Create an account
        </button>
      </form>
      {api.error && <pre className="err">{api.error}</pre>}
    </div>
  );
}
