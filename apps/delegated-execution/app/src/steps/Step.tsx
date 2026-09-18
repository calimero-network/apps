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
  optional = false,
  children,
}: {
  n: number;
  title: string;
  why: ReactNode;
  state?: StepState;
  stateLabel?: string;
  /**
   * Marks a step nothing below it depends on.
   *
   * Worth its own affordance rather than a sentence in `why`: connecting to the
   * cloud used to be step 2 of 6, which reads as required, and the README had
   * to spend a paragraph saying it is not. A step that is genuinely skippable
   * should look skippable.
   */
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`step${optional ? ' optional' : ''}`}>
      <h2>
        <span className="num">{n}</span>
        {title}
        {optional ? <span className="tag">optional</span> : null}
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
 * A group of inputs that share a *provenance* — where their values come from.
 *
 * The page used to put four text boxes in a row: a namespace id, an invitation,
 * a context id and a node signing key. They looked like one kind of thing and
 * are four: one is derivable from another, one is handed to you, one is handed
 * to you separately, and one must be pinned out of band and is the only field
 * on the page whose whole point is that nothing may tell you its value. Four
 * identical `<input>`s said none of that, so the node key — the one that
 * carries a trust decision — looked exactly like the three that do not.
 *
 * Grouping by provenance makes the distinction the layout rather than a
 * paragraph somebody has to read.
 */
export function Provenance({
  kind,
  title,
  note,
  children,
}: {
  /** `held` = this tab minted it, `given` = someone handed it to you, `found` = the cloud answered it, `pinned` = you must establish it yourself. */
  kind: 'held' | 'given' | 'found' | 'pinned';
  title: string;
  note: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`prov prov-${kind}`}>
      <h3>
        <span className="prov-kind">{kind}</span>
        {title}
      </h3>
      <p className="aside prov-note">{note}</p>
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
