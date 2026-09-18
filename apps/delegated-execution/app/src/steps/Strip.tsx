/**
 * What this tab currently holds, always visible.
 *
 * The page is a sequence of panels that each set some state the *later* ones
 * need, and until now the only way to know whether a precondition was met was
 * to scroll back and look at the panel that set it. A button greyed out with no
 * visible reason is the failure mode that produces: the page knew exactly why
 * and showed it six hundred pixels away.
 *
 * So every one of these is a precondition of something below it, in the order
 * they are needed, and each says what it is missing rather than only that it is
 * missing. The strip is not a progress bar — nothing here has to go green, and
 * the cloud slot legitimately stays empty for the whole flow.
 */

import type { ReactNode } from 'react';

/** `ok` is held and usable, `warn` is held but not usable yet, `none` is absent. */
export type SlotState = 'ok' | 'warn' | 'none';

export interface Slot {
  label: string;
  value: ReactNode;
  state: SlotState;
  /** Why this slot is not `ok`, shown on hover. Absent when it is. */
  title?: string;
}

export function Strip({ slots }: { slots: readonly Slot[] }) {
  return (
    <div className="strip" aria-label="What this tab holds">
      {slots.map((slot) => (
        <div key={slot.label} className={`strip-slot ${slot.state}`} title={slot.title}>
          <span className="strip-label">{slot.label}</span>
          <span className="strip-value">{slot.value}</span>
        </div>
      ))}
    </div>
  );
}
