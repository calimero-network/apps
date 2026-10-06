import { useState } from "react";

import AskCard from "../components/AskCard";
import { useAudience } from "../components/AudienceShell";
import { Avatar, Empty } from "../components/bits";
import { AskKindIcon, HandIcon } from "../components/icons";
import { askKind, formatDate, personLabel, useLive } from "../lib/updates";

/**
 * Every ask across every update, in one place.
 *
 * For an investor: the list of ways they can help right now, without digging
 * through six months of updates. For the team: the triage queue for offers,
 * and — below it — the contributions ledger that the next update thanks.
 */
export default function AsksPage() {
  const { me } = useAudience();
  const isTeam = !!me?.is_team;
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const asks = useLive((c) => c.listAsks({ status }), [status]);
  const contributions = useLive((c) => c.listContributions({ since: 0 }), []);
  const items = asks.data ?? [];

  return (
    <>
      <div className="pageHead">
        <div>
          <h1 className="pageTitle">Asks</h1>
          <p className="pageSub">
            {isTeam
              ? "Every request for help across your updates, and the offers that came in."
              : "Specific ways you can help the team right now."}
          </p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Status">
        {(["open", "resolved"] as const).map((s) => (
          <button key={s} role="tab" className="tab" aria-selected={status === s} onClick={() => setStatus(s)}>
            {s === "open" ? "Open" : "Resolved"}
          </button>
        ))}
      </div>

      {asks.error && <div className="error">{asks.error}</div>}
      <div className="stack">
        {items.map((a) => (
          <AskCard key={a.id} ask={a} isTeam={isTeam} showPost onChanged={asks.reload} />
        ))}
      </div>
      {!asks.loading && items.length === 0 && (
        <Empty icon={<HandIcon size={20} />} title={status === "open" ? "No open asks." : "Nothing resolved yet."}>
          {isTeam
            ? "Add asks to an update — intros, hires, customers, advice. They collect here."
            : "When the team asks for help, it shows up here."}
        </Empty>
      )}

      {(contributions.data?.length ?? 0) > 0 && (
        <section className="ledger">
          <h2 className="sectionTitle">Contributions</h2>
          <p className="muted small">Accepted offers of help. The composer can thank everyone since the last update in one click.</p>
          <ul className="ledgerList">
            {contributions.data!.map((c) => (
              <li key={`${c.ask_id}|${c.account}`}>
                <Avatar name={c.name} account={c.account} />
                <div className="ledgerMain">
                  <div>
                    <strong>{personLabel(c.name, c.account)}</strong>
                    {c.firm && <span className="muted"> · {c.firm}</span>}
                  </div>
                  <div className="muted small ledgerWhat">
                    <AskKindIcon kind={c.ask_kind} size={13} /> {askKind(c.ask_kind).label} · {c.ask_title}
                  </div>
                </div>
                <span className="muted small num">{formatDate(c.accepted_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
