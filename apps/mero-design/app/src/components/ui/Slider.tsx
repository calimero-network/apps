import styles from "./controls.module.css";

/**
 * A range input whose track shows how full it is.
 *
 * WebKit draws no progress fill on a range input, so the opacity slider read the
 * same at 5% as at 95% until you found the thumb. The fill is painted with a
 * gradient whose stop comes from the value, handed to CSS as a custom property.
 */

interface Props {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  testId?: string;
  ariaLabel?: string;
}

export default function Slider({
  value, onChange, min = 0, max = 100, step = 1, disabled = false, testId, ariaLabel,
}: Props) {
  const span = max - min;
  const fill = span === 0 ? 0 : ((value - min) / span) * 100;
  return (
    <input
      type="range"
      className={styles.slider}
      style={{ "--fill": `${fill}%` } as React.CSSProperties}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      data-testid={testId}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}
