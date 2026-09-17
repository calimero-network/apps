/**
 * One numbered step: what it does, why, and what came back.
 *
 * The `why` line is not decoration. Every step here fails for reasons that are
 * invisible from its own inputs — an audience the node does not list, a
 * capability an admin has not granted, a membership that was never created —
 * and a demo that showed only buttons would be a worse teaching tool than the
 * shell script it replaces.
 */

import type { ReactNode } from 'react';

/** Where a step is, shown as a pill so the page reads as a progress trail. */
export type StepState = 'idle' | 'done' | 'blocked';

export function Step({
  n,
  title,
  why,
  state = 'idle',
  stateLabel,
  children,
}: {
  n: number;
  title: string;
  why: ReactNode;
  state?: StepState;
  stateLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="step">
      <h2>
        <span className="num">{n}</span>
        {title}
        {stateLabel ? (
          <span className={`pill ${state === 'idle' ? '' : state}`}>{stateLabel}</span>
        ) : null}
      </h2>
      <p className="why">{why}</p>
      {children}
    </section>
  );
}

/**
 * A result panel that distinguishes an error from an answer.
 *
 * Errors are shown verbatim alongside this app's own explanation rather than
 * replaced by it: the node's wording is what a reader will search for, and a
 * demo that swallowed it would make its own guess unfalsifiable.
 */
export function Out({ error, children }: { error?: boolean; children: ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return <div className={`out ${error ? 'err' : 'ok'}`}>{children}</div>;
}
