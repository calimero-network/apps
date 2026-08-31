import { type ElementType } from "react";

/**
 * One label-plus-value readout, shared by the call page's status strip and the
 * data dialog's metric grid.
 *
 * The two had identical copies — same props, same null handling, same
 * `data-testid`/`data-value` wiring — differing only in wrapper element and CSS
 * module. That duplication is worth removing for a specific reason rather than on
 * principle: the `data-value` contract is load-bearing for the browser e2e, which
 * scrapes the raw number because the rendered text carries a unit suffix and an
 * em-dash placeholder. Two copies means that contract is kept consistent by hand.
 *
 * ── Why `null` is rendered, not treated as zero ───────────────────────────────
 *
 * `null` is a distinct, meaningful state in this app and not an oversight:
 * `seqGaps` becomes null with two or more remote senders, because their samples
 * interleave in one list and a span-based gap count is fiction there; latency is
 * null until a remote frame has actually arrived. Printing `0` for "not measured"
 * is a lie the reader cannot detect, so both render as an em-dash — and
 * `data-value` is emptied rather than zeroed, so a driver can tell the difference
 * too.
 */
export function MetricValue({
  label,
  value,
  suffix,
  testId,
  className,
  as: Wrapper = "div",
  wrapperClassName,
  valueClassName,
  labelClassName,
}: {
  label: string;
  value: number | string | null | undefined;
  suffix?: string;
  testId?: string;
  /** Extra class on the VALUE, for severity colouring. */
  className?: string;
  /** `div` for the dialog's grid cell, `span` for the inline strip. */
  as?: ElementType;
  wrapperClassName?: string;
  valueClassName?: string;
  labelClassName?: string;
}) {
  const absent = value === null || value === undefined;
  return (
    <Wrapper className={wrapperClassName}>
      <span
        className={[valueClassName, className].filter(Boolean).join(" ")}
        data-testid={testId}
        data-value={value ?? ""}
      >
        {absent ? "—" : value}
        {!absent && suffix ? suffix : ""}
      </span>
      <span className={labelClassName}>{label}</span>
    </Wrapper>
  );
}
