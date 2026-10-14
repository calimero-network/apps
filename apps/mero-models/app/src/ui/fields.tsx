import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A number you can type or scrub: drag horizontally over it to change the
 * value, as in any modeller's properties panel. A drag previews on every move
 * and commits once at the end, so it is one undo step and one transaction.
 */
export function NumberField({
  label,
  value,
  step = 0.1,
  precision = 3,
  min,
  max,
  suffix,
  disabled,
  axis,
  onBegin,
  onPreview,
  onCommit,
}: {
  label?: string;
  value: number;
  step?: number;
  precision?: number;
  min?: number;
  max?: number;
  suffix?: string;
  disabled?: boolean;
  /** Colours the label like an axis: x red, y green, z blue. */
  axis?: "x" | "y" | "z";
  onBegin?: () => void;
  onPreview?: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const drag = useRef<{ x: number; start: number; moved: boolean; last: number } | null>(null);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const shown = Number.isFinite(value) ? Number(value.toFixed(precision)) : 0;

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled || text !== null || e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, start: value, moved: false, last: value };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 3) return;
    if (!d.moved) {
      d.moved = true;
      onBegin?.();
    }
    const fine = e.shiftKey ? 0.1 : 1;
    const next = clamp(round(d.start + dx * step * 0.25 * fine, precision));
    d.last = next;
    onPreview?.(next);
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) onCommit(d.last);
    else setText(String(shown)); // a click without a drag edits the number
  }

  function commitText() {
    if (text === null) return;
    const parsed = evaluate(text);
    setText(null);
    if (parsed !== null && Number.isFinite(parsed)) onCommit(clamp(parsed));
  }

  return (
    <div className={`num-field ${disabled ? "disabled" : ""}`} data-axis={axis}>
      {label && <span className="num-label">{label}</span>}
      {text !== null ? (
        <input
          autoFocus
          className="num-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitText();
            if (e.key === "Escape") setText(null);
            e.stopPropagation();
          }}
        />
      ) : (
        <div
          className="num-value"
          role="spinbutton"
          aria-valuenow={shown}
          aria-label={label}
          tabIndex={disabled ? -1 : 0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === "Enter") setText(String(shown));
            if (e.key === "ArrowUp") onCommit(clamp(round(value + step, precision)));
            if (e.key === "ArrowDown") onCommit(clamp(round(value - step, precision)));
          }}
        >
          {shown}
          {suffix}
        </div>
      )}
    </div>
  );
}

function round(v: number, places: number): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

/** `2*3`, `1/3`, `-0.5+1`: plain arithmetic, the way a properties panel takes it. Nothing else is evaluated. */
export function evaluate(text: string): number | null {
  const src = text.replace(/\s+/g, "");
  if (!/^[-+*/().\d]+$/.test(src)) return null;
  let i = 0;
  const peek = () => src[i];
  const num = (): number | null => {
    if (peek() === "(") {
      i += 1;
      const v = expr();
      if (peek() !== ")") return null;
      i += 1;
      return v;
    }
    if (peek() === "-" || peek() === "+") {
      const sign = src[i++] === "-" ? -1 : 1;
      const v = num();
      return v === null ? null : sign * v;
    }
    const m = /^\d*\.?\d+(?:e[-+]?\d+)?|^\d+\.?/.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const term = (): number | null => {
    let v = num();
    while (v !== null && (peek() === "*" || peek() === "/")) {
      const op = src[i++];
      const r = num();
      if (r === null) return null;
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  function expr(): number | null {
    let v = term();
    while (v !== null && (peek() === "+" || peek() === "-")) {
      const op = src[i++];
      const r = term();
      if (r === null) return null;
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  const v = expr();
  return i === src.length ? v : null;
}

/**
 * A colour swatch. The native picker fires `input` on every drag of its
 * cursor and `change` once when it closes, which is exactly preview-then-commit.
 */
export function ColorField({
  label,
  value,
  disabled,
  onBegin,
  onPreview,
  onCommit,
}: {
  label?: string;
  value: string;
  disabled?: boolean;
  onBegin?: () => void;
  onPreview?: (v: string) => void;
  onCommit: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const begun = useRef(false);
  const handlers = useRef({ onCommit, onPreview, onBegin });
  handlers.current = { onCommit, onPreview, onBegin };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onInput = () => {
      if (!begun.current) {
        begun.current = true;
        handlers.current.onBegin?.();
      }
      handlers.current.onPreview?.(el.value);
    };
    const onChange = () => {
      begun.current = false;
      handlers.current.onCommit(el.value);
    };
    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    return () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    if (ref.current && ref.current.value !== value) ref.current.value = value;
  }, [value]);

  return (
    <label className={`color-field ${disabled ? "disabled" : ""}`}>
      {label && <span className="num-label">{label}</span>}
      <span className="swatch" style={{ background: value }}>
        <input ref={ref} type="color" defaultValue={value} disabled={disabled} aria-label={label} />
      </span>
      <span className="mono hex">{value}</span>
    </label>
  );
}

export function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`toggle ${disabled ? "disabled" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Section({
  title,
  children,
  defaultOpen = true,
  actions,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`prop-section ${open ? "open" : ""}`}>
      <header>
        <button type="button" className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="caret" aria-hidden="true">
            ▸
          </span>
          {title}
        </button>
        {actions}
      </header>
      {open && <div className="prop-body">{children}</div>}
    </section>
  );
}
