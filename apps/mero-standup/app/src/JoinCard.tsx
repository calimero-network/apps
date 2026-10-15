import { describeInviteFailure } from "@calimero-apps/invite";
import type { JoinFromInvitation } from "./useJoinFromInvitation";

/**
 * The invitation prompt, and the hint for when there is none.
 *
 * An invitation reaches this app only by its link being opened, so there is
 * nothing to paste here: idle, this says where invitations come from; with one
 * captured, it shows what joining would add this node to and asks.
 */
export function JoinCard({ join }: { join: JoinFromInvitation }) {
  const { state, parsed } = join;

  return (
    <div className="card">
      <h2>Join with an invitation</h2>

      {state.stage === "idle" && (
        <p className="empty">
          Open an invitation link someone sent you. It opens this app and asks
          before joining.
        </p>
      )}

      {state.stage === "awaiting-confirmation" && parsed && (
        <div>
          {/*
            The prompt exists because following a link must not act on the
            user's behalf: joining binds their identity to a namespace someone
            else chose and switches their active context. Show WHAT, then ask.
          */}
          <p style={{ marginBottom: 8 }}>
            An invitation is waiting. Joining adds this node to:
          </p>
          <table>
            <tbody>
              <tr>
                <th>namespace</th>
                <td className="mono">{parsed.namespaceId}</td>
              </tr>
              <tr>
                <th>team</th>
                <td className="mono">{parsed.contextId}</td>
              </tr>
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
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
        <p className="empty">Joining the namespace, then the team…</p>
      )}

      {(state.stage === "joined" || state.stage === "already-member") && (
        <p className="empty">Joined. Opening the team…</p>
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
          <div className="row" style={{ marginTop: 12 }}>
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
