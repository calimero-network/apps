import { PasskeySignIn } from "@calimero-apps/passkey";
import "@calimero-apps/passkey/passkey.css";
import type { SessionApi } from "./session";

/** Continue with a passkey, or create one. */
export function SignIn({ api, where }: { api: SessionApi; where: string }) {
  return (
    <div className="method-card" style={{ marginBottom: 16 }}>
      <div className="method-name">Sign in</div>
      <p className="method-hint" style={{ marginBottom: 14 }}>
        Connected to {where}. Accounts are passkeys: nothing to remember, nothing to leak.
      </p>
      <div style={{ maxWidth: 360 }}>
        <PasskeySignIn api={api} />
      </div>
    </div>
  );
}
