import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon } from "./icons";
import styles from "./CopyId.module.css";

/**
 * A long id, shown truncated in mono with a copy button that flips to a check
 * for a moment. The copied flag is presentation only.
 */
export default function CopyId({
  value,
  label = "ID",
  testId,
}: {
  value: string;
  /** What is being copied, for the button's accessible name. */
  label?: string;
  testId?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      /* clipboard unavailable — the id is still selectable */
    }
  };

  return (
    <span className={styles.root}>
      <span className={styles.text} title={value} data-testid={testId}>
        {value}
      </span>
      <button
        type="button"
        className={styles.btn}
        onClick={() => void copy()}
        data-copied={copied}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        title={copied ? "Copied" : `Copy ${label}`}
      >
        {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
        {copied ? "Copied" : null}
      </button>
    </span>
  );
}
