/**
 * The app's glass building blocks: one place for what every dialog, side
 * sheet, menu and button looks like, so the whole app reads as the fleet's
 * light-glass design rather than each component's own idea of it.
 *
 * Fragments, not components: each file keeps its own styled names (and its
 * markup and test ids) and pulls the look in with `${dialogSurface}` etc.
 *
 * ⚠️ Nothing here that holds other content puts `backdrop-filter`, `filter` or
 * `transform` on a box that can contain a `position: fixed` descendant: any of
 * them turns that box into the containing block and traps the menu or dialog
 * inside it. Overlays are themselves fixed to the viewport, so blurring
 * their backdrop is safe; the sheets and dialogs inside them stay plain.
 */
import { css, keyframes } from 'styled-components';
import { C } from '../theme';

export const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`;
export const popIn = keyframes`from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: none; }`;
export const sheetIn = keyframes`from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; }`;

/** The dim, softly blurred layer under a dialog or side sheet. Fixed to the
 *  viewport and covering all of it. */
export const overlay = css`
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--glass-ground) 38%, rgba(14, 18, 34, 0.32));
  -webkit-backdrop-filter: blur(6px) saturate(140%);
  backdrop-filter: blur(6px) saturate(140%);
  animation: ${fadeIn} 0.18s ease both;
`;

/** A centred dialog card: solid (what floats over content never lets it show
 *  through its text), generously rounded, the floating shadow. */
export const dialogSurface = css`
  position: relative;
  background: var(--glass-surface-solid);
  border: 1px solid var(--glass-edge);
  border-radius: 22px;
  box-shadow: var(--glass-shadow-float);
  font-family: var(--glass-font);
  color: ${C.ink};
  animation: ${popIn} 0.22s cubic-bezier(0.22, 1, 0.36, 1) both;
  h3 { font-size: 20px; font-weight: 750; letter-spacing: -0.4px; color: ${C.ink}; }
`;

/** A side sheet: floats inset from the right edge as its own rounded card,
 *  full width on a phone. */
export const sideSheet = css`
  width: var(--sheet-w, 420px);
  max-width: calc(100vw - 24px);
  height: calc(100% - 24px);
  margin: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--glass-surface-solid);
  border: 1px solid var(--glass-edge);
  border-radius: 22px;
  box-shadow: var(--glass-shadow-float);
  font-family: var(--glass-font);
  animation: ${sheetIn} 0.24s cubic-bezier(0.22, 1, 0.36, 1) both;
  @media (max-width: 520px) {
    max-width: none;
    width: calc(100vw - 16px);
    height: calc(100% - 16px);
    margin: 8px;
    border-radius: 20px;
  }
`;

/** A side sheet's title row. */
export const sheetHeader = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 18px 14px 22px;
  border-bottom: 1px solid var(--glass-line);
  flex-shrink: 0;
  .title { font-size: 16px; font-weight: 750; color: ${C.ink}; letter-spacing: -0.3px; }
`;

/** The round × in a sheet or dialog corner. */
export const closeButton = css`
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  font-size: 20px;
  line-height: 1;
  color: var(--glass-ink-2);
  background: var(--glass-sunken);
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  &:hover { background: var(--glass-line-strong); color: ${C.ink}; }
  &:focus-visible { outline: 2px solid var(--glass-accent); outline-offset: 2px; }
`;

const pill = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 40px;
  padding: 0 18px;
  font: 600 13.5px/1 var(--glass-font);
  letter-spacing: -0.1px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.18s, box-shadow 0.2s, transform 0.15s, color 0.15s;
  &:focus-visible { outline: 2px solid var(--glass-accent); outline-offset: 2px; }
  &:disabled { opacity: 0.5; cursor: default; transform: none; }
`;

/** The near-black primary pill (the glass primary action). */
export const primaryPill = css`
  ${pill}
  color: var(--glass-on-ink);
  background: var(--glass-ink);
  border: none;
  box-shadow: 0 10px 24px -12px rgba(14, 18, 34, 0.6);
  &:hover:not(:disabled) { background: var(--glass-ink-2); transform: translateY(-1px); }
`;

/** The quiet white pill beside a primary. */
export const secondaryPill = css`
  ${pill}
  color: ${C.ink};
  background: var(--glass-surface-solid);
  border: none;
  box-shadow: inset 0 0 0 1px var(--glass-line-strong);
  &:hover:not(:disabled) { background: var(--glass-sunken); }
`;

/** A text field. */
export const field = css`
  width: 100%;
  box-sizing: border-box;
  padding: 11px 14px;
  font: 400 14px/1.4 var(--glass-font);
  color: ${C.ink};
  background: var(--glass-sunken);
  border: 1px solid var(--glass-line);
  border-radius: 12px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
  &::placeholder { color: ${C.mutedSoft}; }
  &:focus {
    background: var(--glass-surface-solid);
    border-color: var(--glass-accent);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--glass-accent-solid) 16%, transparent);
  }
  &:disabled { opacity: 0.6; }
`;

/** A filter / category chip. */
export const chip = css`
  font: 600 12px/1 var(--glass-font);
  padding: 7px 12px;
  border-radius: 999px;
  border: none;
  background: var(--glass-sunken);
  color: var(--glass-ink-2);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  &:hover:not(:disabled) { color: ${C.ink}; background: var(--glass-line-strong); }
  &:disabled { opacity: 0.45; cursor: default; }
  &[aria-pressed='true'], &[aria-pressed='true']:hover:not(:disabled) { background: var(--glass-ink); color: var(--glass-on-ink); }
`;
