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
  onConfirm,
  onDecline,
}: {
  state: JoinState;
  onSubmit: (payloadJson: string) => void;
  onConfirm: () => void;
  onDecline: () => void;
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
    <div className="card join-card">
      <div className="card-head">
        <h2>Join with an invitation</h2>
      </div>
      <p className="hint">
        Paste a link or an invitation code. A link that opened this app is
        redeemed automatically — this is for one that arrived some other way.
      </p>

      <div className="row input-row">
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

      {state.status === "confirm" && (
        <div className="confirm">
          {/*
            The prompt exists because following a link must not act on the
            user's behalf: joining binds their identity to a namespace someone
            else chose and switches their active context. Show WHAT, then ask.
          */}
          <p className="confirm-title">An invitation is waiting. Joining adds this node to:</p>
          <table className="kv">
            <tbody>
              <tr>
                <th>namespace</th>
                <td className="mono">{state.payload.namespaceId}</td>
              </tr>
              <tr>
                <th>context</th>
                <td className="mono">{state.payload.contextId}</td>
              </tr>
            </tbody>
          </table>
          <div className="row">
            <button onClick={onConfirm}>Join</button>
            <button className="ghost" onClick={onDecline}>
              Not now
            </button>
          </div>
        </div>
      )}

      {state.status === "joining" && (
        <p className="empty">
          Joining the namespace, then the context…
        </p>
      )}

      {state.status === "failed" && (
        <>
          <pre className="err">{state.message}</pre>
          {/*
            The distinction the user actually needs: will trying again help?
            `@calimero-apps/invite` decides it from the node's status, and errs
            toward retryable, because a dropped invitation is unrecoverable and
            a retried one costs a round trip.
          */}
          {/*
            Two different truths. A LINK-delivered invitation is in the pending
            intent store and really is replayed on the next load; a PASTED one
            was never captured there, so "will be retried" would be a lie for
            the very path this card exists for.
          */}
          <p className="empty">
            {!state.retryable
              ? "This invitation cannot succeed; ask for a new one."
              : state.fromLink
                ? "Kept — this will be retried the next time the app loads."
                : "Not saved — paste it again to retry."}
          </p>
        </>
      )}
    </div>
  );
}
