import { ShieldCheck } from 'lucide-react';

import styles from './TeeBadge.module.css';

const TEE_NOTE =
  'A hardware-attested node keeps this workspace in sync and available when members are offline.';

/**
 * "TEE enabled", for a workspace a TEE node backs. Renders nothing without
 * one. The node is never counted as a person; this is where it shows.
 */
export function TeeBadge({ mode }: { mode: 'relay' | 'replica' | null }) {
  if (!mode) return null;
  const modeLabel = mode === 'relay' ? 'Relay' : 'Replica';
  return (
    <span
      className={styles.tee}
      title={`${TEE_NOTE} Mode: ${modeLabel}.`}
      data-testid="tee-badge"
      data-mode={mode}
    >
      <ShieldCheck size={12} aria-hidden="true" />
      TEE enabled
      <span className={styles.mode}>· {modeLabel}</span>
    </span>
  );
}
