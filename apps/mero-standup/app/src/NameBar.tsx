import { useState } from "react";
import { displayName } from "./lib/people";
import { useRead, type useTeam } from "./useTeam";

type Team = ReturnType<typeof useTeam>;

/**
 * Your display name in this team. Stored in the contract, in your account's
 * own slot, because the point of a name is that everyone ELSE sees it.
 */
export function NameBar({ team, me }: { team: Team; me: string | null }) {
  const { client, version, act } = team;
  const name = useRead(client, version, (c) => (me ? c.getName({ account: me }) : Promise.resolve("")), [me]);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!me) return null;
  const current = name.data ?? "";

  if (draft === null) {
    return (
      <div className="row name-bar">
        <span className="dim">Posting as</span>
        <strong data-testid="my-name">{displayName(me, current)}</strong>
        <button className="link" onClick={() => setDraft(current)}>
          {current ? "Rename" : "Set your name"}
        </button>
      </div>
    );
  }

  return (
    <form
      className="row name-bar"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        act((c) => c.setName({ name: draft }))
          .then(() => setDraft(null))
          .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
      }}
    >
      <input
        aria-label="your name"
        autoFocus
        maxLength={64}
        placeholder="How the team sees you"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button type="submit">Save</button>
      <button type="button" className="ghost" onClick={() => setDraft(null)}>
        Cancel
      </button>
      {error && <span className="err-inline">{error}</span>}
    </form>
  );
}
