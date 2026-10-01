import { useState } from "react";
import type { Member } from "./generated/MeroVoteClient";
import { errText, short, useMeroVote } from "./useMeroVote";

type Mode = "single" | "multi";

/**
 * The poll definition is frozen at creation — its hash is the poll id — so
 * everything a voter relies on (options, bounds, trustees, roll) is decided
 * here and never edited afterwards.
 */
export function CreatePoll({
  contextId,
  me,
  roster,
  onCancel,
  onCreated,
}: {
  contextId: string;
  me: string;
  roster: Member[];
  onCancel: () => void;
  onCreated: (pollId: string) => void;
}) {
  const client = useMeroVote(contextId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [mode, setMode] = useState<Mode>("single");
  const [maxChoices, setMaxChoices] = useState(2);
  const [trustees, setTrustees] = useState<Set<string>>(new Set([me]));
  // null = the default, a majority of however many trustees are picked.
  const [thresholdPick, setThresholdPick] = useState<number | null>(null);
  const [everyone, setEveryone] = useState(true);
  const [voters, setVoters] = useState<Set<string>>(new Set(roster.map((m) => m.account)));
  const [closesAt, setClosesAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const people = roster.some((m) => m.account === me) ? roster : [{ account: me, name: "You" }, ...roster];
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const maxC = Math.min(Math.max(1, maxChoices), Math.max(filled.length, 1));
  const nT = trustees.size;
  const threshold = Math.min(Math.max(1, thresholdPick ?? Math.floor(nT / 2) + 1), Math.max(nT, 1));
  const valid =
    title.trim() &&
    filled.length >= 2 &&
    new Set(filled).size === filled.length &&
    trustees.size >= 1 &&
    (everyone || voters.size >= 1);

  const toggle = (set: Set<string>, v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  async function submit() {
    if (!client || !valid) return;
    setBusy(true);
    setErr(null);
    try {
      const id = await client.createPoll({
        title: title.trim(),
        description: description.trim(),
        options: filled,
        min_choices: mode === "single" ? 1 : 0,
        max_choices: mode === "single" ? 1 : maxC,
        trustees: [...trustees],
        threshold,
        voters: everyone ? [] : [...voters],
        closes_at: closesAt ? new Date(closesAt).getTime() : null,
      });
      onCreated(id);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>New poll</h2>
      <div className="form">
        <label>
          Question
          <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Where do we hold the offsite?" />
        </label>
        <label>
          Details <span className="empty">(optional)</span>
          <textarea value={description} maxLength={4000} rows={2} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <fieldset>
          <legend>Options</legend>
          {options.map((o, i) => (
            <div className="row" key={i}>
              <input
                aria-label={`Option ${i + 1}`}
                value={o}
                maxLength={200}
                placeholder={`Option ${i + 1}`}
                onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
              />
              {options.length > 2 && (
                <button className="ghost" onClick={() => setOptions(options.filter((_, j) => j !== i))} aria-label={`Remove option ${i + 1}`}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {options.length < 16 && (
            <button className="ghost" onClick={() => setOptions([...options, ""])}>
              Add option
            </button>
          )}
        </fieldset>

        <fieldset>
          <legend>Each voter may pick</legend>
          <label className="inline">
            <input type="radio" checked={mode === "single"} onChange={() => setMode("single")} /> exactly one option
          </label>
          <label className="inline">
            <input type="radio" checked={mode === "multi"} onChange={() => setMode("multi")} /> up to{" "}
            <input
              type="number"
              className="narrow"
              min={1}
              max={Math.max(filled.length, 1)}
              value={maxChoices}
              onChange={(e) => setMaxChoices(Number(e.target.value))}
              disabled={mode !== "multi"}
            />{" "}
            options (approval)
          </label>
        </fieldset>

        <fieldset>
          <legend>Trustees — hold the decryption key together</legend>
          <p className="hint">
            Trustees generate the election key together, so no one ever holds all of it. Any threshold of them can
            decrypt the totals; fewer learn nothing. A higher threshold means more privacy and more people who must
            show up to count.
          </p>
          <div className="chips">
            {people.map((m) => (
              <label key={m.account} className={`chip toggle ${trustees.has(m.account) ? "on" : ""}`}>
                <input type="checkbox" checked={trustees.has(m.account)} onChange={() => setTrustees(toggle(trustees, m.account))} />
                {m.account === me ? `${m.name} (you)` : m.name || short(m.account)}
              </label>
            ))}
          </div>
          {nT > 1 && (
            <label className="inline">
              Any{" "}
              <input
                type="number"
                className="narrow"
                aria-label="Threshold"
                min={1}
                max={nT}
                value={threshold}
                onChange={(e) => setThresholdPick(Number(e.target.value))}
              />{" "}
              of the {nT} trustees can decrypt the totals.
            </label>
          )}
          {nT === 1 && trustees.has(me) ? (
            <p className="hint warn">
              With yourself as the only trustee, you alone could decrypt individual ballots. Fine for a quick poll —
              add trustees for a secret one.
            </p>
          ) : threshold === 1 && nT > 1 ? (
            <p className="hint warn">A threshold of 1 lets any single trustee decrypt individual ballots.</p>
          ) : threshold === nT && nT > 1 ? (
            <p className="hint">All {nT} must take part to count: most private, least available.</p>
          ) : null}
        </fieldset>

        <fieldset>
          <legend>Who can vote</legend>
          <label className="inline">
            <input type="radio" checked={everyone} onChange={() => setEveryone(true)} /> every member of this context
          </label>
          <label className="inline">
            <input type="radio" checked={!everyone} onChange={() => setEveryone(false)} /> only these members:
          </label>
          {!everyone && (
            <div className="chips">
              {people.map((m) => (
                <label key={m.account} className={`chip toggle ${voters.has(m.account) ? "on" : ""}`}>
                  <input type="checkbox" checked={voters.has(m.account)} onChange={() => setVoters(toggle(voters, m.account))} />
                  {m.account === me ? `${m.name} (you)` : m.name || short(m.account)}
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <label>
          Planned close <span className="empty">(shown to voters; you close the poll yourself)</span>
          <input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
        </label>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button onClick={() => void submit()} disabled={!valid || busy}>
          {busy ? "Creating…" : "Create poll"}
        </button>
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {err && <pre className="err">{err}</pre>}
    </div>
  );
}
