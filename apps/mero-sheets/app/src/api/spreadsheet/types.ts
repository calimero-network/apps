/**
 * The contract's argument and answer shapes, as the frontend sees them: v1's
 * field names (snake_case) and numbers. On the wire every 64-bit integer is a
 * decimal string; `workbook` converts them back on the way in (see `./workbook`).
 */

/**
 * An activity-log entry, newest first from `get_activity`.
 */
export interface ActivityEntry {
  id: string;
  author: string;
  at: number;
  sheet_id: string;
  kind: string;
  summary: string;
  count: number;
  changes: CellChange[];
}

/**
 * A live attachment.
 */
export interface Attachment {
  id: string;
  sheet_id: string;
  row_id: string;
  col_id: string;
  blob_id: string;
  name: string;
  size: number;
  mime: string;
  created_by: string;
  created_at: number;
}

/**
 * One explicit row or column entry of a sheet.
 */
export interface AxisEntryView {
  id: string;
  pos: string;
  deleted: boolean;
}

/**
 * A structural edit: add a row or column at a fractional position, delete
 * one by id, or restore a deleted one (an undo). Every op is one write,
 * however many cells the sheet holds.
 */
export type AxisOp =
  | { name: "InsertRow"; payload: AxisOp_InsertRow }
  | { name: "InsertCol"; payload: AxisOp_InsertCol }
  | { name: "DeleteRow"; payload: AxisOp_DeleteRow }
  | { name: "DeleteCol"; payload: AxisOp_DeleteCol }
  | { name: "RestoreRow"; payload: AxisOp_RestoreRow }
  | { name: "RestoreCol"; payload: AxisOp_RestoreCol };

export interface AxisOp_DeleteCol {
  id: string;
}

export interface AxisOp_DeleteRow {
  id: string;
}

export interface AxisOp_InsertCol {
  id: string;
  pos: string;
}

export interface AxisOp_InsertRow {
  id: string;
  pos: string;
}

export interface AxisOp_RestoreCol {
  id: string;
}

export interface AxisOp_RestoreRow {
  id: string;
}

/**
 * A row's or column's size: `axis` is `row` or `col`.
 */
export interface AxisSize {
  axis: string;
  id: string;
  size: number;
}

/**
 * A cell, by row and column id. An implicit id is a 0-based position
 * (`"3"` is the fourth row until rows move); the client places ids with the
 * sheet's layout (`get_layouts`).
 */
export interface Cell {
  id: string;
  sheet_id: string;
  row_id: string;
  col_id: string;
  /**
   * As stored: references name rows and columns by id.
   */
  raw_value: string;
  computed_value: string;
  format: string;
  updated_at: number;
  /**
   * Member id of whoever last changed the cell; empty for a cell last
   * written before the activity log existed.
   */
  last_editor: string;
  last_edited_at: number;
}

/**
 * One cell's change within an activity entry: its raw value and format
 * before and after.
 */
export interface CellChange {
  row_id: string;
  col_id: string;
  before_raw: string;
  before_format: string;
  after_raw: string;
  after_format: string;
}

export type CellOp =
  | { name: "Set"; payload: CellOp_Set }
  | { name: "Format"; payload: CellOp_Format }
  | { name: "Clear"; payload: CellOp_Clear };

export interface CellOp_Clear {
  row_id: string;
  col_id: string;
}

export interface CellOp_Format {
  row_id: string;
  col_id: string;
  format: string;
}

export interface CellOp_Set {
  row_id: string;
  col_id: string;
  raw_value: string;
}

/**
 * A styled cell.
 */
export interface CellStyle {
  sheet_id: string;
  row_id: string;
  col_id: string;
  style: Record<string, string>;
}

/**
 * A live chart.
 */
export interface Chart {
  id: string;
  chart: ChartInput;
  created_by: string;
}

/**
 * A chart as written or read: its range by corner ids, its kind and title.
 * The range's first column labels the points; each other column is a
 * series, named by the first row when that row is text.
 */
export interface ChartInput {
  sheet_id: string;
  top_row_id: string;
  left_col_id: string;
  bottom_row_id: string;
  right_col_id: string;
  kind: string;
  title: string;
}

/**
 * A live (not deleted) comment.
 */
export interface Comment {
  id: string;
  sheet_id: string;
  row_id: string;
  col_id: string;
  author: string;
  text: string;
  mentions: string[];
  parent: string;
  resolved: boolean;
  created_at: number;
  updated_at: number;
}

export interface FunctionDef {
  name: string;
  category: string;
  syntax: string;
  description: string;
  example: string;
}

/**
 * A live incoming link.
 */
export interface Link {
  /**
   * Also the linked sheet's id.
   */
  id: string;
  source_context: string;
  source_name: string;
  name: string;
  rows: number;
  cols: number;
  updated_at: number;
}

/**
 * One collaborator, by the name they chose.
 */
export interface Member {
  /**
   * Account hex (`whoami`) — the same key `Cursor.author` carries, so a
   * roster and the live cursors join on it without a translation step.
   */
  id: string;
  nickname: string;
  joined_at: number;
  updated_at: number;
  /**
   * The member's account (hex), as core's group roster names them: the
   * same value as `id`.
   */
  account: string;
  /**
   * `owner`, `editor`, `commenter` or `viewer`.
   */
  role: string;
}

export interface NamedRange {
  name: string;
  /**
   * A reference in stored form.
   */
  target: string;
}

/**
 * One step of a note edit, in the Quill delta shape: keep, insert or delete
 * characters, with formatting on kept or inserted text. Mirrors `DeltaOp`,
 * which has no `AbiType`.
 */
export type NoteChange =
  | NoteChange_Retain
  | NoteChange_Insert
  | NoteChange_Delete;

export interface NoteChange_Delete {
  delete: number;
}

export interface NoteChange_Insert {
  insert: string;
  attributes: Record<string, string> | null;
}

export interface NoteChange_Retain {
  retain: number;
  attributes: Record<string, string> | null;
}

/**
 * A cell that has a note, with the start of its text.
 */
export interface NotedCell {
  sheet_id: string;
  row_id: string;
  col_id: string;
  preview: string;
}

/**
 * The project's own identity, as the UI titles it.
 *
 * `init_project` has always written `project_name`, and until now NOTHING
 * could read it back — there was no view method over the register at all. That
 * is the whole reason the workspace list fell back to names cached in
 * `localStorage`, which meant every peer but the creator saw "Workspace 1".
 */
export interface Project {
  /**
   * Fixed when the workbook is created.
   */
  id: string;
  /**
   * Empty until `init_project` runs.
   */
  name: string;
  created_at: number;
}

/**
 * A live protected range.
 */
export interface Protection {
  id: string;
  sheet_id: string;
  top_row_id: string;
  left_col_id: string;
  bottom_row_id: string;
  right_col_id: string;
  description: string;
  editors: string[];
  created_by: string;
}

/**
 * A live publication.
 */
export interface Publication {
  id: string;
  sheet_id: string;
  top_row_id: string;
  left_col_id: string;
  bottom_row_id: string;
  right_col_id: string;
  target_context: string;
  name: string;
  created_by: string;
}

/**
 * A live rule.
 */
export interface Rule {
  id: string;
  rule: RuleInput;
  created_by: string;
}

/**
 * A rule as written or read: its range by corner ids, and what it does.
 */
export interface RuleInput {
  sheet_id: string;
  top_row_id: string;
  left_col_id: string;
  bottom_row_id: string;
  right_col_id: string;
  /**
   * `format` (style cells that meet the condition), `scale` (shade numbers
   * from `args[0]` at the lowest to `args[1]` at the highest), `validate`
   * (values must meet the condition) or `alert` (tell `recipients` when a
   * value starts meeting it).
   */
  kind: string;
  condition: string;
  args: string[];
  style: Record<string, string>;
  strict: boolean;
  recipients: string[];
}

export interface Sheet {
  id: string;
  name: string;
  position: number;
  created_at: number;
  /**
   * For a linked sheet (read-only, pushed from another workbook), that
   * workbook's name; empty otherwise.
   */
  linked_from: string;
}

/**
 * A sheet's explicit row and column entries. A sheet with none has the
 * implicit layout: row id `k` at row `k`.
 */
export interface SheetLayout {
  sheet_id: string;
  rows: AxisEntryView[];
  cols: AxisEntryView[];
}

/**
 * A sheet's frozen rows and columns and resized rows and columns.
 */
export interface SheetView {
  sheet_id: string;
  frozen_rows: number;
  frozen_cols: number;
  sizes: AxisSize[];
}

export interface Span {
  text: string;
  attributes: Record<string, string>;
}

/**
 * One style change: set `field` of a cell to `value` (empty clears it).
 */
export interface StyleOp {
  row_id: string;
  col_id: string;
  field: string;
  value: string;
}
