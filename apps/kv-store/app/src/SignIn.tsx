import { PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";
import type { SessionApi } from "./session";

/** Continue with a passkey, or create one. */
export function SignIn({ api, where }: { api: SessionApi; where: string }) {
  return (
    <div className="card">
      <h2>Sign in</h2>
      <p className="empty" style={{ marginBottom: 14 }}>
        Connected to {where}. Accounts are passkeys: nothing to remember, nothing to leak.
      </p>
      <div style={{ maxWidth: 360 }}>
        <PasskeySignIn api={api} />
      </div>
    </div>
  );
}
