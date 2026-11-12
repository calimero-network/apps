import Foundation
import MeroKit

// The workbook's types, as the contract (`../../../logic/res/abi.json`) answers them. The calls and
// the types are the generated `SheetsClient` (`Generated/`, `scripts/mobile-codegen.sh` at the repo
// root). Their fields keep the contract's snake_case names (`sheet_id`, `row_id`, ...); the app reads
// and writes them by the camelCase names below, which are those fields under the names the screens
// use.

public typealias ActivityEntry = SheetsClient.ActivityEntry
public typealias Attachment = SheetsClient.Attachment
public typealias AxisEntryView = SheetsClient.AxisEntryView
public typealias AxisSize = SheetsClient.AxisSize
public typealias Cell = SheetsClient.Cell
public typealias CellChange = SheetsClient.CellChange
public typealias CellStyle = SheetsClient.CellStyle
public typealias Chart = SheetsClient.Chart
public typealias ChartInput = SheetsClient.ChartInput
public typealias Comment = SheetsClient.Comment
public typealias FunctionDef = SheetsClient.FunctionDef
public typealias Link = SheetsClient.Link
public typealias Member = SheetsClient.Member
public typealias NamedRange = SheetsClient.NamedRange
public typealias NotedCell = SheetsClient.NotedCell
public typealias Project = SheetsClient.Project
public typealias Protection = SheetsClient.Protection
public typealias Publication = SheetsClient.Publication
public typealias Rule = SheetsClient.Rule
public typealias RuleInput = SheetsClient.RuleInput
public typealias Sheet = SheetsClient.Sheet
public typealias SheetLayout = SheetsClient.SheetLayout
public typealias SheetView = SheetsClient.SheetView
public typealias Span = SheetsClient.Span
public typealias StyleOp = SheetsClient.StyleOp

extension SheetsClient.ActivityEntry {
    public var sheetId: String {
        get { sheet_id }
        set { sheet_id = newValue }
    }
}

extension SheetsClient.Attachment {
    public var sheetId: String {
        get { sheet_id }
        set { sheet_id = newValue }
    }
    public var rowId: String {
        get { row_id }
        set { row_id = newValue }
    }
    public var colId: String {
        get { col_id }
        set { col_id = newValue }
    }
    public var blobId: String {
        get { blob_id }
        set { blob_id = newValue }
    }
    public var createdBy: String {
        get { created_by }
        set { created_by = newValue }
    }
    public var createdAt: UInt64 {
        get { created_at }
        set { created_at = newValue }
    }
}

extension SheetsClient.Cell {
    public var sheetId: String {
        get { sheet_id }
        set { sheet_id = newValue }
    }
    public var rowId: String {
        get { row_id }
        set { row_id = newValue }
    }
    public var colId: String {
        get { col_id }
        set { col_id = newValue }
    }
    public var rawValue: String {
        get { raw_value }
        set { raw_value = newValue }
    }
    public var computedValue: String {
        get { computed_value }
        set { computed_value = newValue }
    }
    public var updatedAt: UInt64 {
        get { updated_at }
        set { updated_at = newValue }
    }
    public var lastEditor: String {
        get { last_editor }
        set { last_editor = newValue }
    }
    public var lastEditedAt: UInt64 {
        get { last_edited_at }
        set { last_edited_at = newValue }
    }
}

extension SheetsClient.CellChange {
    public var rowId: String {
        get { row_id }
        set { row_id = newValue }
    }
    public var colId: String {
        get { col_id }
        set { col_id = newValue }
    }
    public var beforeRaw: String {
        get { before_raw }
        set { before_raw = newValue }
    }
    public var beforeFormat: String {
        get { before_format }
        set { before_format = newValue }
    }
    public var afterRaw: String {
        get { after_raw }
        set { after_raw = newValue }
    }
    public var afterFormat: String {
        get { after_format }
        set { after_format = newValue }
    }
}

extension SheetsClient.CellStyle {
    public var sheetId: String {
        get { sheet_id }
        set { sheet_id = newValue }
    }
    public var rowId: String {
        get { row_id }
        set { row_id = newValue }
    }
    public var colId: String {
        get { col_id }
        set { col_id = newValue }
    }
}

extension SheetsClient.Chart {
    public var createdBy: String {
        get { created_by }
        set { created_by = newValue }
    }
}

extension SheetsClient.ChartInput {
    public var sheetId: String {
        get { sheet_id }
        set { sheet_id = newValue }
    }
    public var topRowId: String {
        get { top_row_id }
        set { top_row_id = newValue }
    }
    public var leftColId: String {
        get { left_col_id }
        set { left_col_id = newValue }
    }
    public var bottomRowId: String {
        get { bottom_row_id }
        set { bottom_row_id = newValue }
    }
    public var rightColId: String {
        get { right_col_id }
        set { right_col_id = newValue }
    }
}

extension SheetsClient.Comment {
    public var sheetId: String {
        get { sheet_id }
        set { sheet_id = newValue }
    }
    public var rowId: String {
        get { row_id }
        set { row_id = newValue }
    }
    public var colId: String {
        get { col_id }
        set { col_id = newValue }
    }
    public var createdAt: UInt64 {
        get { created_at }
        set { created_at = newValue }
    }
    public var updatedAt: UInt64 {
        get { updated_at }
        set { updated_at = newValue }
    }
}

extension SheetsClient.Link {
    public var sourceContext: String {
        get { source_context }
        set { source_context = newValue }
    }
    public var sourceName: String {
        get { source_name }
        set { source_name = newValue }
    }
    public var updatedAt: UInt64 {
        get { updated_at }
        set { updated_at = newValue }
    }
}

extension SheetsClient.Member {
    public var joinedAt: UInt64 {
        get { joined_at }
        set { joined_at = newValue }
    }
    public var updatedAt: UInt64 {
        get { updated_at }
        set { updated_at = newValue }
    }
}

extension SheetsClient.NotedCell {
    public var sheetId: String {
        get { sheet_id }
        set { sheet_id = newValue }
    }
    public var rowId: String {
        get { row_id }
        set { row_id = newValue }
    }
    public var colId: String {
        get { col_id }
        set { col_id = newValue }
    }
}

extension SheetsClient.Project {
    public var createdAt: UInt64 {
        get { created_at }
        set { created_at = newValue }
    }
}

extension SheetsClient.Protection {
    public var sheetId: String {
        get { sheet_id }
        set { sheet_id = newValue }
    }
    public var topRowId: String {
        get { top_row_id }
        set { top_row_id = newValue }
    }
    public var leftColId: String {
        get { left_col_id }
        set { left_col_id = newValue }
    }
    public var bottomRowId: String {
        get { bottom_row_id }
        set { bottom_row_id = newValue }
    }
    public var rightColId: String {
        get { right_col_id }
        set { right_col_id = newValue }
    }
    public var createdBy: String {
        get { created_by }
        set { created_by = newValue }
    }
}

extension SheetsClient.Publication {
    public var sheetId: String {
        get { sheet_id }
        set { sheet_id = newValue }
    }
    public var topRowId: String {
        get { top_row_id }
        set { top_row_id = newValue }
    }
    public var leftColId: String {
        get { left_col_id }
        set { left_col_id = newValue }
    }
    public var bottomRowId: String {
        get { bottom_row_id }
        set { bottom_row_id = newValue }
    }
    public var rightColId: String {
        get { right_col_id }
        set { right_col_id = newValue }
    }
    public var targetContext: String {
        get { target_context }
        set { target_context = newValue }
    }
    public var createdBy: String {
        get { created_by }
        set { created_by = newValue }
    }
}

extension SheetsClient.Rule {
    public var createdBy: String {
        get { created_by }
        set { created_by = newValue }
    }
}

extension SheetsClient.RuleInput {
    public var sheetId: String {
        get { sheet_id }
        set { sheet_id = newValue }
    }
    public var topRowId: String {
        get { top_row_id }
        set { top_row_id = newValue }
    }
    public var leftColId: String {
        get { left_col_id }
        set { left_col_id = newValue }
    }
    public var bottomRowId: String {
        get { bottom_row_id }
        set { bottom_row_id = newValue }
    }
    public var rightColId: String {
        get { right_col_id }
        set { right_col_id = newValue }
    }
}

extension SheetsClient.Sheet {
    public var createdAt: UInt64 {
        get { created_at }
        set { created_at = newValue }
    }
    public var linkedFrom: String {
        get { linked_from }
        set { linked_from = newValue }
    }
}

extension SheetsClient.SheetLayout {
    public var sheetId: String {
        get { sheet_id }
        set { sheet_id = newValue }
    }
}

extension SheetsClient.SheetView {
    public var sheetId: String {
        get { sheet_id }
        set { sheet_id = newValue }
    }
    public var frozenRows: UInt32 {
        get { frozen_rows }
        set { frozen_rows = newValue }
    }
    public var frozenCols: UInt32 {
        get { frozen_cols }
        set { frozen_cols = newValue }
    }
}

extension SheetsClient.StyleOp {
    public var rowId: String {
        get { row_id }
        set { row_id = newValue }
    }
    public var colId: String {
        get { col_id }
        set { col_id = newValue }
    }
}
