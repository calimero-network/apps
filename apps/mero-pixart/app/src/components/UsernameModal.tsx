import { useState } from "react";
import styles from "./UsernameModal.module.css";

interface Props {
  onSubmit: (username: string) => void;
  initialValue?: string;
}

export default function UsernameModal({ onSubmit, initialValue = "" }: Props) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) { setError("Username cannot be empty."); return; }
    if (trimmed.length < 2) { setError("Must be at least 2 characters."); return; }
    if (trimmed.length > 32) { setError("Must be 32 characters or fewer."); return; }
    onSubmit(trimmed);
  }

  return (
    <div className="mp-overlay">
      <div className={`mp-modal ${styles.modal}`} role="dialog" aria-modal="true" aria-labelledby="username-title">
        <h2 id="username-title">Choose a display name</h2>
        <p className="sub">
          This name is shown to collaborators on the canvas. You cannot skip this step.
        </p>
        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            autoFocus
            className="mp-input"
            placeholder="Your name…"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(""); }}
            maxLength={32}
            data-testid="username-input"
          />
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button
            type="submit"
            className="mp-btn mp-btn--primary"
            disabled={!value.trim()}
            data-testid="username-submit"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
