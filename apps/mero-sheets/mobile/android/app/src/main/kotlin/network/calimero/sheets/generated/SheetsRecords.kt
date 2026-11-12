// The workbook's types, as the contract (`logic/res/abi.json`) answers them. The calls and the types
// are the generated [SheetsClient] (`scripts/mobile-codegen.sh` at the repo root). Their fields keep
// the contract's snake_case names (`sheet_id`, `row_id`, ...); the app reads them by the camelCase
// names below, which are those fields under the names the screens use.

package network.calimero.sheets.generated

import network.calimero.sheets.generated.client.SheetsClient

typealias ActivityEntry = SheetsClient.ActivityEntry

typealias Attachment = SheetsClient.Attachment

typealias AxisEntryView = SheetsClient.AxisEntryView

typealias AxisSize = SheetsClient.AxisSize

typealias Cell = SheetsClient.Cell

typealias CellChange = SheetsClient.CellChange

typealias CellStyle = SheetsClient.CellStyle

typealias Chart = SheetsClient.Chart

typealias ChartInput = SheetsClient.ChartInput

typealias Comment = SheetsClient.Comment

typealias FunctionDef = SheetsClient.FunctionDef

typealias Link = SheetsClient.Link

typealias Member = SheetsClient.Member

typealias NamedRange = SheetsClient.NamedRange

typealias NotedCell = SheetsClient.NotedCell

typealias Project = SheetsClient.Project

typealias Protection = SheetsClient.Protection

typealias Publication = SheetsClient.Publication

typealias Rule = SheetsClient.Rule

typealias RuleInput = SheetsClient.RuleInput

typealias Sheet = SheetsClient.Sheet

typealias SheetLayout = SheetsClient.SheetLayout

typealias SheetView = SheetsClient.SheetView

typealias Span = SheetsClient.Span

typealias StyleOp = SheetsClient.StyleOp

val SheetsClient.ActivityEntry.sheetId: String get() = sheet_id

val SheetsClient.Attachment.sheetId: String get() = sheet_id

val SheetsClient.Attachment.rowId: String get() = row_id

val SheetsClient.Attachment.colId: String get() = col_id

val SheetsClient.Attachment.blobId: String get() = blob_id

val SheetsClient.Attachment.createdBy: String get() = created_by

val SheetsClient.Attachment.createdAt: ULong get() = created_at

val SheetsClient.Cell.sheetId: String get() = sheet_id

val SheetsClient.Cell.rowId: String get() = row_id

val SheetsClient.Cell.colId: String get() = col_id

val SheetsClient.Cell.rawValue: String get() = raw_value

val SheetsClient.Cell.computedValue: String get() = computed_value

val SheetsClient.Cell.updatedAt: ULong get() = updated_at

val SheetsClient.Cell.lastEditor: String get() = last_editor

val SheetsClient.Cell.lastEditedAt: ULong get() = last_edited_at

val SheetsClient.CellChange.rowId: String get() = row_id

val SheetsClient.CellChange.colId: String get() = col_id

val SheetsClient.CellChange.beforeRaw: String get() = before_raw

val SheetsClient.CellChange.beforeFormat: String get() = before_format

val SheetsClient.CellChange.afterRaw: String get() = after_raw

val SheetsClient.CellChange.afterFormat: String get() = after_format

val SheetsClient.CellStyle.sheetId: String get() = sheet_id

val SheetsClient.CellStyle.rowId: String get() = row_id

val SheetsClient.CellStyle.colId: String get() = col_id

val SheetsClient.Chart.createdBy: String get() = created_by

val SheetsClient.ChartInput.sheetId: String get() = sheet_id

val SheetsClient.ChartInput.topRowId: String get() = top_row_id

val SheetsClient.ChartInput.leftColId: String get() = left_col_id

val SheetsClient.ChartInput.bottomRowId: String get() = bottom_row_id

val SheetsClient.ChartInput.rightColId: String get() = right_col_id

val SheetsClient.Comment.sheetId: String get() = sheet_id

val SheetsClient.Comment.rowId: String get() = row_id

val SheetsClient.Comment.colId: String get() = col_id

val SheetsClient.Comment.createdAt: ULong get() = created_at

val SheetsClient.Comment.updatedAt: ULong get() = updated_at

val SheetsClient.Link.sourceContext: String get() = source_context

val SheetsClient.Link.sourceName: String get() = source_name

val SheetsClient.Link.updatedAt: ULong get() = updated_at

val SheetsClient.Member.joinedAt: ULong get() = joined_at

val SheetsClient.Member.updatedAt: ULong get() = updated_at

val SheetsClient.NotedCell.sheetId: String get() = sheet_id

val SheetsClient.NotedCell.rowId: String get() = row_id

val SheetsClient.NotedCell.colId: String get() = col_id

val SheetsClient.Project.createdAt: ULong get() = created_at

val SheetsClient.Protection.sheetId: String get() = sheet_id

val SheetsClient.Protection.topRowId: String get() = top_row_id

val SheetsClient.Protection.leftColId: String get() = left_col_id

val SheetsClient.Protection.bottomRowId: String get() = bottom_row_id

val SheetsClient.Protection.rightColId: String get() = right_col_id

val SheetsClient.Protection.createdBy: String get() = created_by

val SheetsClient.Publication.sheetId: String get() = sheet_id

val SheetsClient.Publication.topRowId: String get() = top_row_id

val SheetsClient.Publication.leftColId: String get() = left_col_id

val SheetsClient.Publication.bottomRowId: String get() = bottom_row_id

val SheetsClient.Publication.rightColId: String get() = right_col_id

val SheetsClient.Publication.targetContext: String get() = target_context

val SheetsClient.Publication.createdBy: String get() = created_by

val SheetsClient.Rule.createdBy: String get() = created_by

val SheetsClient.RuleInput.sheetId: String get() = sheet_id

val SheetsClient.RuleInput.topRowId: String get() = top_row_id

val SheetsClient.RuleInput.leftColId: String get() = left_col_id

val SheetsClient.RuleInput.bottomRowId: String get() = bottom_row_id

val SheetsClient.RuleInput.rightColId: String get() = right_col_id

val SheetsClient.Sheet.createdAt: ULong get() = created_at

val SheetsClient.Sheet.linkedFrom: String get() = linked_from

val SheetsClient.SheetLayout.sheetId: String get() = sheet_id

val SheetsClient.SheetView.sheetId: String get() = sheet_id

val SheetsClient.SheetView.frozenRows: UInt get() = frozen_rows

val SheetsClient.SheetView.frozenCols: UInt get() = frozen_cols

val SheetsClient.StyleOp.rowId: String get() = row_id

val SheetsClient.StyleOp.colId: String get() = col_id
