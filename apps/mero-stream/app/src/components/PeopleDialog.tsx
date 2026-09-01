import { useEffect, useRef, useState } from "react";
import { useDialogOpen } from "../hooks/useDialogOpen";
import { initials, type Person } from "../lib/people";
import styles from "./PeopleDialog.module.css";

/**
 * Your nickname, and who else is in the room.
 *
 * One dialog for both, in the order they matter to someone opening it. They were
 * separate ideas and are better together: "who is in this room" and "what am I
 * called in it" are the same question from two sides, and a name field on its own
 * gives you no way to check the change landed — here you see yourself in the list
 * underneath it.
 *
 * The name control used to be an unlabelled input wedged into the top bar next to
 * a button that said "Rename", which is not somewhere anyone looks for their own
 * identity. It also defaulted to a placeholder, so a room full of people all
 * showed the same word.
 */
export default function PeopleDialog({
  open,
  onClose,
  people,
  name,
  onRename,
  maxBroadcasters,
}: {
  open: boolean;
  onClose: () => void;
  people: Person[];
  /** The stored nickname, or "" when the user has never set one. */
  name: string;
  onRename: (next: string) => void;
  maxBroadcasters: number;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const [draft, setDraft] = useState(name);
  const [saved, setSaved] = useState(false);

  useDialogOpen(ref, open);

  // Re-seed the draft each time it opens, so an abandoned edit does not persist
  // as a stale value the next time someone looks.
  useEffect(() => {
    if (open) {
      setDraft(name);
      setSaved(false);
    }
  }, [open, name]);

  const trimmed = draft.trim();
  const dirty = trimmed.length > 0 && trimmed !== name;

  const save = () => {
    if (!dirty) return;
    onRename(trimmed);
    setSaved(true);
  };

  const live = people.filter((p) => p.live).length;

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      data-testid="people-dialog"
      onClose={onClose}
    >
      <div className={styles.head}>
        <h2 className={styles.headTitle}>You and the room</h2>
        <span className={styles.headSpacer} />
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          data-testid="people-dialog-close"
        >
          Close
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="nickname">
            Your nickname
          </label>
          <p className={styles.help}>
            This is the name on your tile, and what everyone else in the room
            sees. It is stored on this device only.
          </p>
          <div className={styles.nameRow}>
            <input
              id="nickname"
              className={styles.input}
              value={draft}
              data-unset={name === ""}
              onChange={(e) => {
                setDraft(e.target.value);
                setSaved(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && save()}
              maxLength={40}
              placeholder="e.g. Ana"
              autoComplete="nickname"
              data-testid="username-input"
            />
            <button
              type="button"
              className={styles.saveBtn}
              onClick={save}
              disabled={!dirty}
              data-testid="username-submit"
            >
              Save
            </button>
          </div>
          {name === "" && !saved && (
            <p className={styles.help} data-testid="nickname-unset">
              You have not picked a name yet, so your tile shows a placeholder.
            </p>
          )}
          {saved && (
            <span className={styles.saved} data-testid="nickname-saved">
              Saved — everyone sees it within a few seconds.
            </span>
          )}
        </div>

        <div className={styles.field}>
          <h3 className={styles.sectionTitle}>
            In this room · {people.length} ·{" "}
            {`${live}/${maxBroadcasters} broadcasting`}
          </h3>
          {people.length === 0 ? (
            <p className={styles.empty}>
              Still reading the roster from the contract…
            </p>
          ) : (
            <ul className={styles.list} data-testid="people-list">
              {people.map((p) => (
                <li
                  key={p.memberId}
                  className={styles.person}
                  data-testid="person-row"
                  data-live={p.live}
                  data-self={p.isSelf}
                >
                  <span
                    className={`${styles.avatar} ${p.isSelf ? styles.avatarSelf : ""}`}
                    aria-hidden="true"
                  >
                    {initials(p.name)}
                  </span>
                  <span className={styles.who}>
                    <span className={styles.name}>
                      {p.name}
                      {p.isSelf ? " (you)" : ""}
                    </span>
                    <span className={styles.id} title={p.memberId}>
                      {p.memberId.slice(0, 16)}…
                    </span>
                  </span>
                  <span
                    className={`${styles.badge} ${p.live ? styles.badgeLive : ""}`}
                  >
                    {p.live ? (
                      <>
                        <span className={styles.dot} /> live
                      </>
                    ) : (
                      "watching"
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.help}>
            Anyone can watch. Only {maxBroadcasters} people can broadcast at
            once — the limit is what the network carries, not a policy. See{" "}
            <strong>See more data</strong> for the numbers.
          </p>
        </div>
      </div>
    </dialog>
  );
}
