import { useCallback, useEffect, useRef, useState } from "react";
import { hexToRgb, rgbToHex, clamp } from "../utils/raster";
import styles from "./ColorPicker.module.css";

interface Props {
  value: string;
  onChange: (hex: string) => void;
  onClose: () => void;
  /** Optional dialog title (e.g. "Layer color"). */
  title?: string;
}

const PRESETS = [
  "#000000", "#404040", "#808080", "#bfbfbf", "#ffffff",
  "#ff5d6c", "#ffb02e", "#ffe14d", "#43d17a", "#3aa0ff",
  "#A5FF11", "#9b5de5", "#f15bb5", "#00bbf9", "#0F1419",
];

const SWATCH_KEY = "mp-swatches";

function loadSwatches(): string[] {
  try {
    const raw = localStorage.getItem(SWATCH_KEY);
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) ? arr.slice(0, 60) : [];
  } catch { return []; }
}

/** Trailing alpha (0..255) parsed from a #rgba / #rrggbbaa hex (255 if none). */
function parseAlpha(hex: string): number {
  const h = hex.replace("#", "");
  if (h.length === 8) return parseInt(h.slice(6, 8), 16);
  if (h.length === 4) return parseInt(h[3] + h[3], 16);
  return 255;
}

/** Append a two-digit alpha to a 6-digit hex when not fully opaque. */
function withAlpha(hex6: string, a: number): string {
  return a >= 255 ? hex6 : hex6 + clamp(Math.round(a), 0, 255).toString(16).padStart(2, "0");
}

// ── HSV <-> RGB helpers (h: 0..360, s/v: 0..1) ────────────────────────────────
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60) { rp = c; gp = x; }
  else if (h < 120) { rp = x; gp = c; }
  else if (h < 180) { gp = c; bp = x; }
  else if (h < 240) { gp = x; bp = c; }
  else if (h < 300) { rp = x; bp = c; }
  else { rp = c; bp = x; }
  return [
    Math.round((rp + m) * 255),
    Math.round((gp + m) * 255),
    Math.round((bp + m) * 255),
  ];
}

// ── HSL helpers (h: 0..360, s/l: 0..100) ──────────────────────────────────────
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sn = s / 100, ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let rp = 0, gp = 0, bp = 0;
  if (h < 60) { rp = c; gp = x; }
  else if (h < 120) { rp = x; gp = c; }
  else if (h < 180) { gp = c; bp = x; }
  else if (h < 240) { gp = x; bp = c; }
  else if (h < 300) { rp = x; bp = c; }
  else { rp = c; bp = x; }
  return [
    Math.round((rp + m) * 255),
    Math.round((gp + m) * 255),
    Math.round((bp + m) * 255),
  ];
}

export default function ColorPicker({ value, onChange, onClose, title = "Color picker" }: Props) {
  const [r0, g0, b0] = hexToRgb(value);
  const init = rgbToHsv(r0, g0, b0);
  const [hue, setHue] = useState(init.h);
  const [sat, setSat] = useState(init.s);
  const [val, setVal] = useState(init.v);
  const [alpha, setAlpha] = useState(parseAlpha(value));
  const [hexText, setHexText] = useState(value);
  const [swatches, setSwatches] = useState<string[]>(loadSwatches);
  // The colour as it was when the dialog opened (current vs previous compare).
  const prevRef = useRef(value);
  // Floating dialog position (Photoshop-style movable picker).
  const [pos, setPos] = useState(() => ({
    x: Math.max(8, window.innerWidth / 2 - 130),
    y: Math.max(8, window.innerHeight / 2 - 230),
  }));

  const svRef = useRef<HTMLDivElement | null>(null);
  const draggingSv = useRef(false);
  const draggingHue = useRef(false);
  const hueRef = useRef<HTMLDivElement | null>(null);
  const dragPanel = useRef<{ dx: number; dy: number } | null>(null);

  const [cr, cg, cb] = hsvToRgb(hue, sat, val);
  const currentHex = rgbToHex(cr, cg, cb);
  const currentHexA = withAlpha(currentHex, alpha);
  const hsl = rgbToHsl(cr, cg, cb);

  // Push live changes to parent + sync hex field whenever HSV (or alpha) moves.
  const emit = useCallback((h: number, s: number, v: number, a: number = alpha) => {
    const hex = withAlpha(rgbToHex(...hsvToRgb(h, s, v)), a);
    setHexText(hex);
    onChange(hex);
  }, [onChange, alpha]);

  // Apply an absolute RGB/HSL value: re-derive HSV (our source of truth) + emit.
  const applyRgb = useCallback((r: number, g: number, b: number) => {
    const cl = (n: number) => clamp(Math.round(n), 0, 255);
    const hsv = rgbToHsv(cl(r), cl(g), cl(b));
    setHue(hsv.h); setSat(hsv.s); setVal(hsv.v);
    emit(hsv.h, hsv.s, hsv.v);
  }, [emit]);

  const setAlphaAndEmit = useCallback((a: number) => {
    setAlpha(a);
    emit(hue, sat, val, a);
  }, [emit, hue, sat, val]);

  const saveSwatch = useCallback(() => {
    setSwatches((prev) => {
      if (prev.includes(currentHexA)) return prev;
      const next = [currentHexA, ...prev].slice(0, 60);
      try { localStorage.setItem(SWATCH_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [currentHexA]);

  const removeSwatch = useCallback((hex: string) => {
    setSwatches((prev) => {
      const next = prev.filter((s) => s !== hex);
      try { localStorage.setItem(SWATCH_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const applyHex = useCallback((hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    setAlpha(parseAlpha(hex));
    const hsv = rgbToHsv(r, g, b);
    setHue(hsv.h); setSat(hsv.s); setVal(hsv.v);
    emit(hsv.h, hsv.s, hsv.v, parseAlpha(hex));
  }, [emit]);

  const applyHsl = useCallback((h: number, s: number, l: number) => {
    const [r, g, b] = hslToRgb(clamp(h, 0, 360), clamp(s, 0, 100), clamp(l, 0, 100));
    applyRgb(r, g, b);
  }, [applyRgb]);

  const updateSvFromPointer = useCallback((clientX: number, clientY: number) => {
    const el = svRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const s = clamp((clientX - rect.left) / rect.width, 0, 1);
    const v = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
    setSat(s);
    setVal(v);
    emit(hue, s, v);
  }, [emit, hue]);

  const updateHueFromPointer = useCallback((clientY: number) => {
    const el = hueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const h = clamp((clientY - rect.top) / rect.height, 0, 1) * 360;
    setHue(h);
    emit(h, sat, val);
  }, [emit, sat, val]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (draggingSv.current) updateSvFromPointer(e.clientX, e.clientY);
      else if (draggingHue.current) updateHueFromPointer(e.clientY);
      else if (dragPanel.current) {
        setPos({ x: e.clientX - dragPanel.current.dx, y: e.clientY - dragPanel.current.dy });
      }
    }
    function onUp() {
      draggingSv.current = false;
      draggingHue.current = false;
      dragPanel.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [updateSvFromPointer, updateHueFromPointer]);

  function commitHex(text: string) {
    const t = text.trim().replace(/^#?/, "#");
    if (/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(t)) {
      applyHex(t);
    } else {
      setHexText(currentHexA);
    }
  }

  function pickPreset(hex: string) {
    applyHex(hex);
  }

  const hueColor = rgbToHex(...hsvToRgb(hue, 1, 1));

  return (
    <div className={styles.backdrop} onPointerDown={onClose}>
      <div
        className={`mp-modal ${styles.panel}`}
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
        data-testid="color-picker"
      >
        <div
          className={styles.titleBar}
          onPointerDown={(e) => {
            dragPanel.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
          }}
        >
          <span className={styles.titleText}>{title}</span>
          <button
            type="button"
            className={styles.closeX}
            aria-label="Close"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className={styles.body}>
          <div
            ref={svRef}
            className={styles.sv}
            style={{ backgroundColor: hueColor }}
            onPointerDown={(e) => {
              draggingSv.current = true;
              updateSvFromPointer(e.clientX, e.clientY);
            }}
          >
            <div className={styles.svWhite} />
            <div className={styles.svBlack} />
            <div
              className={styles.svThumb}
              style={{ left: `${sat * 100}%`, top: `${(1 - val) * 100}%` }}
            />
          </div>

          <div
            ref={hueRef}
            className={styles.hue}
            onPointerDown={(e) => {
              draggingHue.current = true;
              updateHueFromPointer(e.clientY);
            }}
          >
            <div
              className={styles.hueThumb}
              style={{ top: `${(hue / 360) * 100}%` }}
            />
          </div>
        </div>

        <div className={styles.wheelRow}>
          <HueSatWheel hue={hue} sat={sat} val={val} onPick={(h, s) => { setHue(h); setSat(s); emit(h, s, val); }} />
          <div className={styles.compare}>
            <span className={styles.compareLabel}>new</span>
            <div className={`${styles.compareSwatch} mp-checkerboard`}>
              <span style={{ background: currentHexA }} />
            </div>
            <button
              type="button"
              className={`${styles.compareSwatch} mp-checkerboard`}
              title="Revert to previous color"
              aria-label="Revert to previous color"
              onClick={() => applyHex(prevRef.current)}
            >
              <span style={{ background: prevRef.current }} />
            </button>
            <span className={styles.compareLabel}>current</span>
          </div>
        </div>

        {/* Alpha / opacity */}
        <div className={styles.sliders} data-testid="alpha-slider">
          <Slider label="A" max={255} value={alpha} accent="#bbbbbb" onChange={setAlphaAndEmit} />
        </div>

        {/* RGB sliders */}
        <div className={styles.sliders} data-testid="rgb-sliders">
          <Slider label="R" max={255} value={cr} accent="#ff4d4d" onChange={(n) => applyRgb(n, cg, cb)} />
          <Slider label="G" max={255} value={cg} accent="#4dd24d" onChange={(n) => applyRgb(cr, n, cb)} />
          <Slider label="B" max={255} value={cb} accent="#4d8bff" onChange={(n) => applyRgb(cr, cg, n)} />
        </div>

        {/* HSL sliders */}
        <div className={styles.sliders} data-testid="hsl-sliders">
          <Slider label="H" max={360} value={Math.round(hsl.h)} onChange={(n) => applyHsl(n, hsl.s, hsl.l)} />
          <Slider label="S" max={100} value={Math.round(hsl.s)} onChange={(n) => applyHsl(hsl.h, n, hsl.l)} />
          <Slider label="L" max={100} value={Math.round(hsl.l)} onChange={(n) => applyHsl(hsl.h, hsl.s, n)} />
        </div>

        <div className={styles.hexRow}>
          <span className={`${styles.swatch} mp-checkerboard`}><span style={{ display: "block", width: "100%", height: "100%", backgroundColor: currentHexA }} /></span>
          <input
            className="mp-input"
            value={hexText}
            spellCheck={false}
            onChange={(e) => setHexText(e.target.value)}
            onBlur={(e) => commitHex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitHex((e.target as HTMLInputElement).value);
            }}
            data-testid="color-hex-input"
            aria-label="Hex color"
          />
        </div>

        <div className={styles.presets}>
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={styles.preset}
              style={{ backgroundColor: p }}
              title={p}
              aria-label={p}
              onClick={() => pickPreset(p)}
            />
          ))}
        </div>

        {/* Saveable swatches library */}
        <div className={styles.swatchHead}>
          <span className={styles.swatchTitle}>Swatches</span>
          <button type="button" className={styles.addSwatch} title="Save current color" aria-label="Save current color" onClick={saveSwatch}>＋</button>
        </div>
        <div className={styles.presets} data-testid="swatch-library">
          {swatches.length === 0 && <span className={styles.swatchEmpty}>No saved swatches</span>}
          {swatches.map((p) => (
            <button
              key={p}
              type="button"
              className={`${styles.preset} mp-checkerboard`}
              title={`${p} — click to use, right-click to remove`}
              aria-label={p}
              onClick={() => pickPreset(p)}
              onContextMenu={(e) => { e.preventDefault(); removeSwatch(p); }}
            >
              <span className={styles.presetFill} style={{ backgroundColor: p }} />
            </button>
          ))}
        </div>

        <div className={styles.footer}>
          <button type="button" className="mp-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Hue/Saturation color wheel ────────────────────────────────────────────────
// Angle = hue, radius = saturation, brightness from the current `val`. Clicking
// or dragging picks hue+sat; a thumb marks the current colour.
const WHEEL = 116;
function HueSatWheel({ hue, sat, val, onPick }: {
  hue: number; sat: number; val: number; onPick: (h: number, s: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = WHEEL * dpr; c.height = WHEEL * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const R = WHEEL / 2;
    const img = ctx.createImageData(WHEEL, WHEEL);
    const d = img.data;
    for (let y = 0; y < WHEEL; y++) {
      for (let x = 0; x < WHEEL; x++) {
        const dx = x - R, dy = y - R;
        const dist = Math.hypot(dx, dy);
        const i = (y * WHEEL + x) * 4;
        if (dist > R) { d[i + 3] = 0; continue; }
        let ang = Math.atan2(dy, dx) * 180 / Math.PI;
        if (ang < 0) ang += 360;
        const s = Math.min(1, dist / R);
        const [r, g, b] = hsvToRgb(ang, s, val);
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
        d[i + 3] = dist > R - 1 ? Math.round((R - dist) * 255) : 255; // soft edge
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [val]);

  const pick = (e: { clientX: number; clientY: number }) => {
    const c = ref.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const R = WHEEL / 2;
    const dx = e.clientX - rect.left - R;
    const dy = e.clientY - rect.top - R;
    let ang = Math.atan2(dy, dx) * 180 / Math.PI;
    if (ang < 0) ang += 360;
    const s = Math.min(1, Math.hypot(dx, dy) / R);
    onPick(ang, s);
  };

  useEffect(() => {
    const move = (e: PointerEvent) => { if (dragging.current) pick(e); };
    const up = () => { dragging.current = false; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const R = WHEEL / 2;
  const a = (hue * Math.PI) / 180;
  const tx = R + Math.cos(a) * sat * R;
  const ty = R + Math.sin(a) * sat * R;

  return (
    <div className={styles.wheelWrap} style={{ width: WHEEL, height: WHEEL }}>
      <canvas
        ref={ref}
        style={{ width: WHEEL, height: WHEEL, borderRadius: "50%" }}
        onPointerDown={(e) => { dragging.current = true; pick(e); }}
      />
      <div className={styles.wheelThumb} style={{ left: tx, top: ty }} />
    </div>
  );
}

// Compact label + range + numeric input row used for RGB/HSL channels.
function Slider({
  label, value, max, accent, onChange,
}: {
  label: string; value: number; max: number; accent?: string; onChange: (n: number) => void;
}) {
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>{label}</span>
      <input
        className={styles.sliderRange}
        type="range"
        min={0}
        max={max}
        value={value}
        style={accent ? { accentColor: accent } : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
      <input
        className={styles.sliderNum}
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${label} value`}
      />
    </div>
  );
}
