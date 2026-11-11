import { useState } from "react";
import { browserPasskey } from "@calimero-network/mero-js";
import { approveNative, declineNative, type NativeApprovalRequest, type NativeApprover } from "./native";

export interface NativeApprovalProps {
  /** The app's name, as the person knows it: "Mero Chat". */
  appName: string;
  /** The app's own callback, e.g. `mero-chat://approved`. */
  callback: string;
  /** What signs; mero-js `browserPasskey()` by default (replaced in tests). */
  approver?: NativeApprover;
  request?: NativeApprovalRequest | null;
  go?: (url: string) => void;
}

/**
 * The page a native app opens for a passkey approval (`#native-approve`, see
 * `./native`). Safari asks for a passkey only from a tap, so it waits for one.
 */
export function NativeApproval({ appName, callback, approver, request, go }: NativeApprovalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await approveNative({ approver: approver ?? browserPasskey(), callback, request, go });
    } catch (e) {
      setError(e instanceof Error && e.name === "NotAllowedError" ? "The passkey prompt was closed. Try again." : String((e as Error)?.message ?? e));
      setBusy(false);
    }
  };
  return (
    <main className="cp-approve">
      <div className="cp-passkey cp-approve__card">
        <h1 className="cp-approve__title">Approve in {appName}</h1>
        <p className="cp-passkey__hint">
          {appName} on your phone asks you to confirm a change with your passkey. Continue only if you just asked for
          it in the app.
        </p>
        {error ? (
          <p className="cp-passkey__error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="button" className="cp-passkey__primary" disabled={busy} onClick={() => void approve()} data-testid="native-approve">
          {busy ? "Waiting for your passkey…" : "Approve with passkey"}
        </button>
        <button
          type="button"
          className="cp-passkey__link"
          disabled={busy}
          onClick={() => declineNative({ callback, request, go })}
          data-testid="native-decline"
        >
          Cancel
        </button>
      </div>
    </main>
  );
}
