import { useState } from "react";
import { Link } from "react-router-dom";

import type { AskView } from "../generated/UpdatesClient";
import { askKind, personLabel, timeAgo, useUpdatesClient } from "../lib/updates";

/**
 * One ask, from whichever side you are on.
 *
 * Reader: one click on "I can help", an optional note, done — Cabal's point
 * that an ask answered in two clicks gets answered. Team: the offers, with
 * Accept / Decline, and Resolve when the ask is met. Accepted offers become the
 * contributions the next update thanks.
 */
export default function AskCard({
  ask,
  isTeam,
  showPost,
  onChanged,
}: {
  ask: AskView;
  isTeam: boolean;
  showPost?: boolean;
  onChanged: () => void;
}) {
  const client = useUpdatesClient();
  const kind = askKind(ask.kind);
  const [offering, setOffering] = useState(false);
  const [note, setNote] = useState(ask.my_offer?.note ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const open = ask.status === "open";

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="ask" data-status={ask.status} data-testid="ask">
      <div className="askHead">
        <span className="askKind" title={kind.hint}>
          <span aria-hidden>{kind.icon}</span> {kind.label}
        </span>
        {!open && <span className="pill ok">Resolved</span>}
        <span className="grow" />
        <span className="muted small">
          {ask.offer_count} offer{ask.offer_count === 1 ? "" : "s"}
        </span>
      </div>
      <h3 className="askTitle">{ask.title}</h3>
      {ask.detail && <p className="askDetail">{ask.detail}</p>}
      {showPost && (
        <p className="muted small">
          From <Link to={`/a/p/${ask.post_id}`}>{ask.post_title}</Link> · {timeAgo(ask.created_at)}
        </p>
      )}

      {!isTeam && open && (
        <div className="askActions">
          {ask.my_offer && !offering ? (
            <div className="row wrap">
              <span className="pill ok" data-testid="offered">
                {ask.my_offer.status === "accepted"
                  ? "✓ The team accepted your offer"
                  : ask.my_offer.status === "declined"
                    ? "The team has this covered — thank you"
                    : "✓ You offered to help"}
              </span>
              <button className="linkBtn" onClick={() => setOffering(true)}>
                Edit note
              </button>
              <button
                className="linkBtn danger"
                disabled={busy === "withdraw"}
                onClick={() =>
                  void run("withdraw", async () => {
                    await client!.withdrawOffer({ ask_id: ask.id });
                  })
                }
              >
                Withdraw
              </button>
            </div>
          ) : offering ? (
            <div className="offerForm">
              <textarea
                rows={2}
                placeholder="How can you help? e.g. “I know their VP Finance — happy to intro.”"
                value={note}
                autoFocus
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="row end">
                <button className="ghost small" onClick={() => setOffering(false)}>
                  Cancel
                </button>
                <button
                  className="primary small"
                  disabled={busy === "offer"}
                  onClick={() =>
                    void run("offer", async () => {
                      await client!.offerHelp({ ask_id: ask.id, note: note.trim() });
                      setOffering(false);
                    })
                  }
                >
                  {busy === "offer" ? "Sending…" : "Send offer"}
                </button>
              </div>
            </div>
          ) : (
            <div className="row wrap">
              <button
                className="primary small"
                data-testid="offer-help"
                disabled={busy === "offer"}
                onClick={() =>
                  void run("offer", async () => {
                    await client!.offerHelp({ ask_id: ask.id, note: "" });
                  })
                }
              >
                🙋 I can help
              </button>
              <button className="ghost small" onClick={() => setOffering(true)}>
                Help with a note
              </button>
            </div>
          )}
        </div>
      )}

      {isTeam && (
        <div className="askActions">
          {ask.offers.length > 0 && (
            <ul className="offers">
              {ask.offers.map((o) => (
                <li key={o.account} className="offer" data-status={o.status}>
                  <div className="offerWho">
                    <strong>{personLabel(o.name, o.account)}</strong>
                    {o.firm && <span className="muted"> · {o.firm}</span>}
                    <span className="muted small"> · {timeAgo(o.created_at)}</span>
                  </div>
                  {o.note && <p className="offerNote">“{o.note}”</p>}
                  <div className="row small">
                    {o.status === "offered" ? (
                      <>
                        <button
                          className="primary small"
                          disabled={!!busy}
                          onClick={() =>
                            void run(`acc:${o.account}`, () =>
                              client!.setOfferStatus({ ask_id: ask.id, account: o.account, status: "accepted" }),
                            )
                          }
                        >
                          Accept
                        </button>
                        <button
                          className="ghost small"
                          disabled={!!busy}
                          onClick={() =>
                            void run(`dec:${o.account}`, () =>
                              client!.setOfferStatus({ ask_id: ask.id, account: o.account, status: "declined" }),
                            )
                          }
                        >
                          Decline
                        </button>
                      </>
                    ) : (
                      <>
                        <span className={`pill ${o.status === "accepted" ? "ok" : ""}`}>
                          {o.status === "accepted" ? "Accepted" : "Declined"}
                        </span>
                        <button
                          className="linkBtn"
                          onClick={() =>
                            void run(`undo:${o.account}`, () =>
                              client!.setOfferStatus({ ask_id: ask.id, account: o.account, status: "offered" }),
                            )
                          }
                        >
                          Undo
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {ask.offers.length === 0 && open && <p className="muted small">No offers yet.</p>}
          <button
            className="linkBtn"
            disabled={!!busy}
            onClick={() =>
              void run("status", () =>
                client!.setAskStatus({ ask_id: ask.id, status: open ? "resolved" : "open" }),
              )
            }
          >
            {open ? "Mark resolved" : "Re-open"}
          </button>
        </div>
      )}
      {error && <p className="errorText">{error}</p>}
    </article>
  );
}
