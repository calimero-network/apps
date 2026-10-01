import { useState } from "react";

import { useAudience } from "../components/AudienceShell";
import { Avatar, CategoryChip } from "../components/bits";
import type { EngagementRow, PersonView } from "../generated/UpdatesClient";
import { formatDate, personLabel, timeAgo, useLive, useUpdatesClient } from "../lib/updates";

/**
 * Who is here, and — for the team — who is engaged.
 *
 * The engagement view is Visible's "who opened it" rebuilt on read receipts
 * the contract records when an investor opens an update. The honest
 * difference from a tracking pixel: the reader's own node writes the receipt,
 * in plain sight, and it is a first open, not a guess from an image load.
 */
export default function PeoplePage() {
  const { me, reload: reloadShell } = useAudience();
  const isTeam = !!me?.is_team;
  const people = useLive((c) => c.listPeople(), []);
  const engagement = useLive((c) => (isTeam ? c.getEngagement() : Promise.resolve([] as EngagementRow[])), [isTeam]);

  const team = (people.data ?? []).filter((p) => p.is_team);
  const investors = (people.data ?? []).filter((p) => !p.is_team);

  return (
    <>
      <MyProfile onSaved={reloadShell} />

      <h2 className="sectionLabel">Team</h2>
      <div className="peopleList">
        {team.map((p) => (
          <PersonRow key={p.account} person={p} isAdmin={!!me?.is_admin} self={me?.account} onChanged={people.reload} />
        ))}
      </div>

      <h2 className="sectionLabel">
        Investors &amp; advisors <span className="muted">({investors.length})</span>
      </h2>
      {investors.length === 0 && (
        <p className="muted">Nobody yet. Invite people from the audiences page — anyone with the link joins as a reader.</p>
      )}
      <div className="peopleList">
        {investors.map((p) => (
          <PersonRow
            key={p.account}
            person={p}
            isAdmin={!!me?.is_admin}
            self={me?.account}
            showEngagement={isTeam}
            onChanged={people.reload}
          />
        ))}
      </div>

      {isTeam && (engagement.data?.length ?? 0) > 0 && (
        <>
          <h2 className="sectionLabel">Who read what</h2>
          {engagement.data!.map((row) => (
            <EngagementCard key={row.post_id} row={row} />
          ))}
        </>
      )}
    </>
  );
}

function PersonRow({
  person,
  isAdmin,
  self,
  showEngagement,
  onChanged,
}: {
  person: PersonView;
  isAdmin: boolean;
  self?: string;
  showEngagement?: boolean;
  onChanged: () => void;
}) {
  const client = useUpdatesClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggleTeam = async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      if (person.is_team) await client.removeTeammate({ account: person.account });
      else await client.addTeammate({ account: person.account });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const pct = person.updates_total ? Math.round((person.updates_read / person.updates_total) * 100) : 0;

  return (
    <div className="person" data-testid="person">
      <Avatar name={person.name} account={person.account} team={person.is_team} />
      <div className="personMain">
        <div>
          <strong>{personLabel(person.name, person.account)}</strong>
          {person.account === self && <span className="youTag"> (you)</span>}
          {person.firm && <span className="muted"> · {person.firm}</span>}
          {person.is_admin && <span className="teamTag">Admin</span>}
        </div>
        {showEngagement && (
          <div className="muted small">
            Read {person.updates_read}/{person.updates_total} ({pct}%) · last read {timeAgo(person.last_read_at)} ·{" "}
            {person.comments} repl{person.comments === 1 ? "y" : "ies"} · {person.offers} offer
            {person.offers === 1 ? "" : "s"}
            {person.accepted_offers > 0 && ` (${person.accepted_offers} accepted)`}
          </div>
        )}
        {showEngagement && (
          <div className="bar" aria-hidden>
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {isAdmin && !person.is_admin && (
        <button className="ghost small" disabled={busy} onClick={() => void toggleTeam()}>
          {person.is_team ? "Remove from team" : "Make teammate"}
        </button>
      )}
      {error && <span className="errorText">{error}</span>}
    </div>
  );
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function EngagementCard({ row }: { row: EngagementRow }) {
  const total = row.readers.length + row.not_read.length;
  return (
    <details className="engagement">
      <summary>
        <strong>{row.title}</strong>
        <span className="muted small">
          {" "}
          · {formatDate(row.published_at)} · {row.readers.length}/{total} read · {plural(row.reactions, "reaction")} ·{" "}
          {plural(row.comments, "reply", "replies")} · {plural(row.offers, "offer")}
        </span>
      </summary>
      <div className="engagementCols">
        <div>
          <span className="sectionLabel">Read</span>
          {row.readers.length === 0 && <p className="muted small">Nobody yet.</p>}
          {row.readers.map((r) => (
            <div key={r.account} className="small">
              ✓ {personLabel(r.name, r.account)} <span className="muted">· {timeAgo(r.first_at)}</span>
            </div>
          ))}
        </div>
        <div>
          <span className="sectionLabel">Not yet — follow up</span>
          {row.not_read.length === 0 && <p className="muted small">Everyone has read it.</p>}
          {row.not_read.map((r) => (
            <div key={r.account} className="small">
              ○ {personLabel(r.name, r.account)}
              {r.firm && <span className="muted"> · {r.firm}</span>}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function MyProfile({ onSaved }: { onSaved: () => void }) {
  const client = useUpdatesClient();
  const { me, categories } = useAudience();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [firm, setFirm] = useState("");
  if (!me) return null;
  return (
    <section className="myProfile">
      {editing ? (
        <div className="row wrap">
          <input aria-label="Your name" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
          <input aria-label="Fund or firm" value={firm} maxLength={64} onChange={(e) => setFirm(e.target.value)} />
          <button
            className="primary small"
            onClick={async () => {
              await client?.setProfile({ name, firm });
              setEditing(false);
              onSaved();
            }}
          >
            Save
          </button>
          <button className="ghost small" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="row wrap">
          <span>
            You are <strong>{personLabel(me.name, me.account)}</strong>
            {me.firm && <span className="muted"> · {me.firm}</span>}
          </span>
          <button
            className="linkBtn"
            onClick={() => {
              setName(me.name);
              setFirm(me.firm);
              setEditing(true);
            }}
          >
            Edit
          </button>
        </div>
      )}
      {categories.length > 0 && (
        <>
          <div className="muted small" style={{ marginTop: 10 }}>
            Categories you follow — muted ones stop counting as unread:
          </div>
          <div className="following" data-testid="following">
            {categories.map((c) => (
              <CategoryChip
                key={c.id}
                category={{ ...c, name: c.muted ? `${c.name} (muted)` : c.name }}
                active={!c.muted}
                onClick={async () => {
                  const muted = categories.filter((x) => x.muted).map((x) => x.id);
                  const next = c.muted ? muted.filter((id) => id !== c.id) : [...muted, c.id];
                  await client?.setMutedCategories({ category_ids: next });
                  onSaved();
                }}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
