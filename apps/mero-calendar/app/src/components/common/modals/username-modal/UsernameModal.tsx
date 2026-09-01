import { useState } from "react";
import styles from "./username-modal.module.scss";

interface Props {
  defaultName?: string;
  onSubmit: (name: string) => void;
  onSkip: () => void;
}

/** First-visit prompt to pick a display name shown to teammates on events. */
export default function UsernameModal({ defaultName = "", onSubmit, onSkip }: Props) {
  const [name, setName] = useState(defaultName);
  return (
    <div className="mc-overlay" data-testid="username-modal">
      <div className={styles.modal}>
        <h2 className={styles.title}>Pick a display name</h2>
        <p className={styles.sub}>
          Teammates will see this name on the events you create and invite them to.
        </p>
        <input
          autoFocus
          className="mc-input"
          placeholder="e.g. Alice"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit(name)}
          data-testid="username-input"
        />
        <div className={styles.actions}>
          <button className="mc-btn mc-btn--ghost" onClick={onSkip}>
            Skip
          </button>
          <button
            className="mc-btn mc-btn--primary"
            onClick={() => onSubmit(name)}
            disabled={!name.trim()}
            data-testid="username-submit"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
