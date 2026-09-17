import { useEffect, useRef, useState } from "react";

import type { Nickname } from "../lib/nickname";

/**
 * "You are posting as …", and the one control that changes it.
 *
 * Deliberately a bar rather than a settings page. The name matters at exactly
 * one moment — when you are about to write something under it — so it belongs
 * next to the composer, not two clicks away behind a gear.
 *
 * An unset name is not a quiet default: it is called out, because the fallback
 * is a 64-hex account id and nobody reading the thread learns anything from it.
 */
export default function NicknameBar({ nickname }: { nickname: Nickname }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nickname.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-sync when the name changes underneath us (the background publish, or a
  // second tab), but never while the field is open — that would overwrite what
  // is being typed.
  useEffect(() => {
    if (!editing) setDraft(nickname.name);
  }, [nickname.name, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = async () => {
    await nickname.rename(draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="namebar" data-testid="nickname-bar">
        <label className="namebarLabel" htmlFor="nickname">
          Post as
        </label>
        <input
          id="nickname"
          ref={inputRef}
          className="namebarInput"
          value={draft}
          maxLength={64}
          placeholder="e.g. Ana"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") {
              setDraft(nickname.name);
              setEditing(false);
            }
          }}
          data-testid="nickname-input"
        />
        <button
          className="primary"
          onClick={() => void save()}
          disabled={nickname.saving}
        >
          {nickname.saving ? "Saving…" : "Save"}
        </button>
        <button
          className="ghost"
          onClick={() => {
            setDraft(nickname.name);
            setEditing(false);
          }}
        >
          Cancel
        </button>
        {nickname.error && <span className="error">{nickname.error}</span>}
      </div>
    );
  }

  return (
    <div className="namebar" data-testid="nickname-bar">
      {nickname.name ? (
        <span className="namebarText">
          You are posting as <strong>{nickname.name}</strong>
        </span>
      ) : (
        <span className="namebarText" data-unset="true">
          You have not picked a name — your posts will show an account id
        </span>
      )}
      <button
        className="ghost"
        onClick={() => setEditing(true)}
        data-testid="nickname-edit"
      >
        {nickname.name ? "Change" : "Pick a name"}
      </button>
    </div>
  );
}
