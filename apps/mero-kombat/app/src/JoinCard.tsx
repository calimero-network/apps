import { describeInviteFailure } from "@calimero-apps/invite";
import type { JoinFromInvitation } from "./useJoinFromInvitation";

/**
 * The invitation prompt.
 *
 * An invitation reaches this app only by its link being opened, so there is
 * nothing to paste here: with one captured, this shows what joining would add
 * this node to, asks, and reports how it went. Nothing captured, nothing drawn.
 */
export function JoinCard({ join }: { join: JoinFromInvitation }) {
  const { state, parsed } = join;
  if (state.stage === "idle") return null;

  return (
    <div className="card join-card">
      <div className="card-head">
        <h2>Join with an invitation</h2>
      </div>

      {state.stage === "awaiting-confirmation" && parsed && (
        <div className="confirm">
          {/*
            The prompt exists because following a link must not act on the
            user's behalf: joining binds their identity to a namespace someone
            else chose and switches their active context. Show WHAT, then ask.
          */}
          <p className="confirm-title">
            An invitation is waiting. Joining adds this node to:
          </p>
          <table className="kv">
            <tbody>
              <tr>
                <th>namespace</th>
                <td className="mono">{parsed.namespaceId}</td>
              </tr>
              <tr>
                <th>context</th>
                <td className="mono">{parsed.contextId}</td>
              </tr>
            </tbody>
          </table>
          <div className="row">
            <button onClick={join.accept} data-testid="invite-accept">
              Join
            </button>
            <button
              className="ghost"
              onClick={join.decline}
              data-testid="invite-decline"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {state.stage === "joining" && (
        <p className="empty">Joining the namespace, then the context…</p>
      )}

      {(state.stage === "joined" || state.stage === "already-member") && (
        <p className="empty">Joined. Opening the arena…</p>
      )}

      {state.stage === "failed" && (
        <>
          <pre className="err" data-testid="invite-error">
            {describeInviteFailure(state.reason, "namespace") ?? state.message}
          </pre>
          {/*
            The distinction the user actually needs: will trying again help?
            `@calimero-apps/invite` decides it from the node's status, and errs
            toward retryable, because a dropped invitation is unrecoverable and
            a retried one costs a round trip. A retryable one is still in the
            pending intent store, so it really does come back on the next load.
          */}
          <p className="empty">
            {state.retryable
              ? "Kept — it will be offered again the next time the app opens."
              : "This invitation cannot succeed; ask for a new one."}
          </p>
          <div className="row">
            {state.retryable && (
              <button onClick={join.retry} data-testid="invite-retry">
                Try again
              </button>
            )}
            <button className="ghost" onClick={join.dismiss}>
              Dismiss
            </button>
          </div>
        </>
      )}
    </div>
  );
}
