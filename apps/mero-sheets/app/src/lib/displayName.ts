// Your name in a workspace, and the name to SUGGEST when one asks.
//
// The name lives in the workspace (org member metadata), asked once per
// workspace: every spreadsheet in it copies it into its own roster (`join`)
// without asking. `selfNameStep` decides that when a spreadsheet opens.
//
// ── Why this is in localStorage and the real nickname is not ─────────────────
//
// The nickname that other people see lives in the CONTRACT (`join(nickname)`),
// because that is the only place a name can live if anybody else is to read it —
// localStorage is per-browser, so a name kept there is visible to exactly the
// one person who does not need it.
//
// What lives here is different and much smaller: the last name you typed, so
// the second spreadsheet you open does not ask you to type it again. Losing it
// costs one keystroke session, which is the right price for something that must
// never be load-bearing. So every access is wrapped — `localStorage` throws
// outright in Safari private mode and when site data is blocked — and the
// callers treat "" as "ask".

import { decideSelfName } from '@calimero-apps/names';

const KEY = 'mero-sheets:display-name';

/** Longest name the contract will accept (`validate_label`, MAX_LABEL_LEN). */
export const MAX_NAME_LEN = 64;

/**
 * Trim and clamp a typed name to what the contract accepts.
 *
 * Done on the way IN rather than only validating on submit, because the
 * alternative is a round-trip that fails with "invalid input: label must be at
 * most 64 characters" — a message written for a developer.
 */
export function normaliseName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  return Array.from(trimmed).slice(0, MAX_NAME_LEN).join('');
}

/** True when a name is something the contract will accept. */
export function isUsableName(raw: string): boolean {
  const n = normaliseName(raw);
  return n.length > 0 && Array.from(n).length <= MAX_NAME_LEN;
}

/** The last name this browser used, or "" when there is none. */
export function rememberedName(): string {
  try {
    return normaliseName(window.localStorage.getItem(KEY) ?? '');
  } catch {
    return '';
  }
}

/** Remember a name as the default for the next spreadsheet. Never throws. */
export function rememberName(name: string): void {
  try {
    const n = normaliseName(name);
    if (n) window.localStorage.setItem(KEY, n);
  } catch {
    /* private mode / blocked site data — the name just is not suggested next time */
  }
}

// ── Once per workspace ───────────────────────────────────────────────────────

/** Workspaces whose name question was skipped this session (not per spreadsheet). */
const skipped = new Set<string>();

/** Leave `org` unnamed for this session: no spreadsheet in it asks again. */
export function skipWorkspaceName(org: string): void {
  skipped.add(org);
}

export function workspaceNameSkipped(org: string | null | undefined): boolean {
  return !!org && skipped.has(org);
}

export type SelfNameStep =
  /** The workspace's names or this spreadsheet's roster have not loaded. */
  | { kind: 'wait' }
  /** The workspace has your name: copy it into the roster, no prompt. */
  | { kind: 'use'; name: string }
  /** A name this spreadsheet's roster or this browser already had: publish it to the workspace, no prompt. */
  | { kind: 'adopt'; name: string }
  /** No name anywhere: ask once for the workspace, offering `suggestion`. */
  | { kind: 'ask'; suggestion: string }
  /** Asked and skipped in this workspace already. */
  | { kind: 'skipped' };

/**
 * What to do about your name when a spreadsheet opens. Never asks when the
 * workspace already has a name for you, and asks at most once per workspace.
 */
export function selfNameStep(input: {
  org: string | null;
  orgReady: boolean;
  orgName: string;
  /** Your nickname in this spreadsheet's roster, "" when it has none. */
  rosterName: string;
}): SelfNameStep {
  const d = decideSelfName({
    orgReady: input.orgReady,
    orgName: normaliseName(input.orgName),
    fallbacks: [normaliseName(input.rosterName), rememberedName()],
  });
  if (d.kind === 'ask') {
    if (workspaceNameSkipped(input.org)) return { kind: 'skipped' };
    return { kind: 'ask', suggestion: normaliseName(d.suggestion) || rememberedName() };
  }
  if (d.kind === 'wait') return d;
  return { kind: d.kind, name: normaliseName(d.name) };
}
