/**
 * Who may change what: workbook roles and protected ranges, as the contract
 * checks them, so the app can show a cell as locked before a write is
 * refused. The contract is the authority; this only mirrors it.
 *
 * Two strengths of check. Owner-only actions (roles, protected ranges, the
 * workbook's name, stopping others' links, deleting others' comments and
 * files) are held by storage on every node, so a modified app cannot get
 * round them. A viewer's or commenter's limits on the shared data itself
 * (cells, sheets, styles, rules) are checked by the app a member runs: they
 * keep honest members to their role, not a member who modifies their node.
 */
import type { Protection } from '../api/spreadsheet/SpreadsheetClient';
import type { Rect } from './refs';

export const WORKBOOK_ROLES = ['owner', 'editor', 'commenter', 'viewer'] as const;
export type WorkbookRole = (typeof WORKBOOK_ROLES)[number];

export const ROLE_HELP: Record<WorkbookRole, string> = {
  owner: 'Edits everything, manages roles and protected ranges',
  editor: 'Edits cells, sheets and notes, except protected ranges',
  commenter: 'Views and comments (a limit the app keeps, not a lock)',
  viewer: 'Views only (a limit the app keeps, not a lock)',
};

/** Shown where roles are set: what a role does and does not guarantee. */
export const ROLE_NOTE =
  'Only owners can change roles, protected ranges and the workbook name, and remove others’ comments, files and links: '
  + 'every member’s node enforces that. Viewer and commenter limits on cells and sheets are kept by the app, '
  + 'so they stop honest mistakes, not someone who modifies their own node.';

export const canEdit = (role: string) => role === 'owner' || role === 'editor';
export const canComment = (role: string) => canEdit(role) || role === 'commenter';

/** A protection placed on the grid. `allowed`: this user may edit inside it. */
export interface PlacedProtection {
  id: string;
  rect: Rect;
  allowed: boolean;
  description: string;
  wholeSheet: boolean;
}

/** Where a cell id sits now, or null when its row or column is gone. */
type Locate = (rowId: string, colId: string) => { row: number; col: number } | null;

const WHOLE: Rect = { top: 0, left: 0, bottom: Number.MAX_SAFE_INTEGER, right: Number.MAX_SAFE_INTEGER };

/**
 * A sheet's protections as position rectangles. A range whose corner row or
 * column was deleted no longer resolves, and the contract ignores it too.
 */
export function placeProtections(
  protections: readonly Protection[],
  sheetId: string,
  locate: Locate,
  selfId: string | null,
  role: string,
): PlacedProtection[] {
  const out: PlacedProtection[] = [];
  for (const p of protections) {
    if (p.sheet_id !== sheetId) continue;
    const allowed = role === 'owner' || (!!selfId && p.editors.includes(selfId));
    const wholeSheet = !p.top_row_id && !p.left_col_id && !p.bottom_row_id && !p.right_col_id;
    let rect = WHOLE;
    if (!wholeSheet) {
      const a = locate(p.top_row_id, p.left_col_id);
      const b = locate(p.bottom_row_id, p.right_col_id);
      if (!a || !b) continue;
      rect = {
        top: Math.min(a.row, b.row), left: Math.min(a.col, b.col),
        bottom: Math.max(a.row, b.row), right: Math.max(a.col, b.col),
      };
    }
    out.push({ id: p.id, rect, allowed, description: p.description, wholeSheet });
  }
  return out;
}

/** Why this user may not edit a cell, or null when they may. */
export function lockedReason(placed: readonly PlacedProtection[], role: string, row: number, col: number): string | null {
  if (!canEdit(role)) return `You are ${role === 'commenter' ? 'a commenter' : 'a viewer'} in this workbook`;
  const p = placed.find((x) => !x.allowed && row >= x.rect.top && row <= x.rect.bottom && col >= x.rect.left && col <= x.rect.right);
  if (!p) return null;
  return `Protected${p.description ? `: ${p.description}` : ''}`;
}
