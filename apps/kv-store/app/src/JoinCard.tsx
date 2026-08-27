import { useState } from "react";
import type { JoinState } from "./useJoinFromInvitation";
import { parseInvitationInput } from "./utils/invitation";

/**
 * Paste-an-invitation, and the status of one arriving by deep link.
 *
 * The paste path exists because the deep-link path cannot work until the app has
 * a published `links.frontend`, and because a link that arrived over a channel
 * the launcher does not handle still has to be redeemable.
 */
export function JoinCard({
  state,
  onSubmit,
}: {
  state: JoinState;
  onSubmit: (payloadJson: string) => void;
}) {
  const [input, setInput] = useState("");
  const [invalid, setInvalid] = useState(false);

  function submit() {
    const json = parseInvitationInput(input);
    if (!json) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSubmit(json);
  }

  return (
    <div className="card">
      <h2>Join with an invitation</h2>
      <p className="empty" style={{ marginBottom: 14 }}>
        Paste a link or an invitation code. A link that opened this app is
        redeemed automatically — this is for one that arrived some other way.
      </p>

      <div className="row">
        <input
          placeholder="https://links.calimero.network/… or a code"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setInvalid(false);
          }}
          aria-label="invitation"
        />
        <button onClick={submit} disabled={!input.trim() || state.status === "joining"}>
          {state.status === "joining" ? "Joining…" : "Join"}
        </button>
      </div>

      {invalid && (
        <pre className="err">
          That does not look like an invitation. Paste the whole link, or the code
          from it.
        </pre>
      )}

      {state.status === "joining" && (
        <p className="empty" style={{ marginTop: 12 }}>
          Joining the namespace, then the context…
        </p>
      )}

      {state.status === "failed" && (
        <>
          <pre className="err">{state.message}</pre>
          {/*
            The distinction the user actually needs: will trying again help?
            `isTerminalInvitationError` errs toward retryable, because a dropped
            invitation is unrecoverable and a retried one costs a round trip.
          */}
          <p className="empty">
            {state.retryable
              ? "Kept — this will be retried the next time the app loads."
              : "This invitation cannot succeed; ask for a new one."}
          </p>
        </>
      )}
    </div>
  );
}
