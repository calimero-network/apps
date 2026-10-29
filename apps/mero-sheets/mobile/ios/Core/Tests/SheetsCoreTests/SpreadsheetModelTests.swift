import MeroKit
import XCTest

@testable import SheetsCore

@MainActor
final class SpreadsheetModelTests: XCTestCase {
    private let ctx = "ctx-1"

    private func seeded() -> FakeSheets {
        let fake = FakeSheets()
        fake.seedProject("Q3 Budget", in: ctx)
        fake.seedSheet("s1", name: "Sheet 1", position: 0, in: ctx)
        fake.seedSheet("s2", name: "Data", position: 1, in: ctx)
        fake.seedCell("s1", "0", "0", raw: "Month", in: ctx)
        fake.seedCell("s1", "0", "1", raw: "Sales", in: ctx)
        fake.seedCell("s1", "1", "0", raw: "Jan", in: ctx)
        fake.seedCell("s1", "1", "1", raw: "1200", format: "currency", in: ctx)
        fake.seedCell("s1", "2", "0", raw: "Feb", in: ctx)
        fake.seedCell("s1", "2", "1", raw: "=[s2]!A1*2", computed: "84", in: ctx)
        fake.seedCell("s2", "0", "0", raw: "42", in: ctx)
        fake.styles[ctx] = [CellStyle(sheetId: "s1", rowId: "0", colId: "0", style: ["bold": "1"]),
                            CellStyle(sheetId: "s1", rowId: "9", colId: "3", style: ["fill": "#ffee00"])]
        fake.views[ctx] = [SheetView(sheetId: "s1", frozenRows: 1, frozenCols: 1, sizes: [AxisSize(axis: "col", id: "0", size: 160)])]
        fake.charts[ctx] = [Chart(
            id: "c1",
            chart: ChartInput(sheetId: "s1", topRowId: "0", leftColId: "0", bottomRowId: "2", rightColId: "1", kind: "line", title: ""),
            createdBy: fake.account)]
        return fake
    }

    private func model(_ fake: FakeSheets) -> SpreadsheetModel {
        SpreadsheetModel(client: SheetsClient(contract: fake.backend.contract, contextId: ctx), contextId: ctx)
    }

    func testLoadPlacesCellsWithFormatsStylesAndFrozenPanes() async throws {
        let m = model(seeded())
        await m.load()
        XCTAssertEqual(m.phase, .loaded)
        XCTAssertEqual(m.projectName, "Q3 Budget")
        XCTAssertEqual(m.sheets.map(\.name), ["Sheet 1", "Data"])
        let grid = try XCTUnwrap(m.grid)
        XCTAssertEqual(grid.frozenRows, 1)
        XCTAssertEqual(grid.frozenCols, 1)
        XCTAssertEqual(grid.width(0), 160)
        XCTAssertEqual(grid.cells[GridPos(row: 1, col: 1)]?.text, "$1,200.00")
        XCTAssertTrue(grid.cells[GridPos(row: 0, col: 0)]?.look.bold == true)
        // A styled empty cell still draws.
        XCTAssertEqual(grid.cells[GridPos(row: 9, col: 3)]?.look.fill, 0xFFEE00)
        // The node's computed value is shown; the formula reads with the sheet's name.
        let formula = try XCTUnwrap(grid.cells[GridPos(row: 2, col: 1)])
        XCTAssertEqual(formula.text, "84")
        XCTAssertEqual(formula.raw, "=Data!A1*2")
        XCTAssertNotNil(m.editBlock(at: formula.pos))
    }

    func testSwitchingTabs() async {
        let m = model(seeded())
        await m.load()
        m.selected = GridPos(row: 1, col: 1)
        m.selectSheet("s2")
        XCTAssertEqual(m.activeSheetId, "s2")
        XCTAssertNil(m.selected)
        XCTAssertEqual(m.grid?.cells[GridPos(row: 0, col: 0)]?.text, "42")
    }

    func testChartsReadTheirRange() async throws {
        let m = model(seeded())
        await m.load()
        let chart = try XCTUnwrap(m.sheetCharts.first)
        XCTAssertEqual(chart.kind, "line")
        XCTAssertEqual(chart.range, "A1:B3")
        XCTAssertEqual(chart.title, "Sales")
        XCTAssertEqual(chart.model.labels, ["Jan", "Feb"])
        XCTAssertEqual(chart.model.series.first?.values, [1200, 84])
    }

    func testEditingAPlainValue() async throws {
        let fake = seeded()
        let m = model(fake)
        await m.load()
        try await m.setValue("950", at: GridPos(row: 1, col: 1))
        XCTAssertEqual(fake.cell("s1", "1", "1", in: ctx)?.rawValue, "950")
        XCTAssertEqual(m.grid?.cells[GridPos(row: 1, col: 1)]?.computed, "950")
        // A new cell past the content.
        try await m.setValue("hello", at: GridPos(row: 20, col: 4))
        XCTAssertEqual(fake.cell("s1", "20", "4", in: ctx)?.rawValue, "hello")
        // Empty clears.
        try await m.setValue("", at: GridPos(row: 20, col: 4))
        XCTAssertNil(fake.cell("s1", "20", "4", in: ctx))
    }

    func testFormulasAndReadOnlyAreRefused() async {
        let fake = seeded()
        fake.seedSheet("s3", name: "Linked", position: 2, linkedFrom: "Ledger", in: ctx)
        fake.members[ctx] = []
        let m = model(fake)
        await m.load()
        do {
            try await m.setValue("=1+1", at: GridPos(row: 5, col: 5))
            XCTFail("expected a refusal")
        } catch {
            XCTAssertEqual(error as? SheetsError, .message("Formulas are written in the web app. Enter a plain value here."))
        }
        m.selectSheet("s3")
        XCTAssertEqual(m.editBlock(at: GridPos(row: 0, col: 0)), "This sheet is linked from Ledger, so it is read-only here.")
    }

    func testViewersCannotEdit() async {
        let fake = seeded()
        fake.members[ctx] = [Member(id: fake.account, nickname: "Ana", joinedAt: 1, updatedAt: 1, account: fake.account, role: "viewer")]
        let m = model(fake)
        await m.load()
        XCTAssertEqual(m.role, "viewer")
        XCTAssertEqual(m.editBlock(at: GridPos(row: 0, col: 0)), "You are a viewer in this workbook.")
        XCTAssertFalse(m.canComment)
    }

    func testProtectedRange() async {
        let fake = seeded()
        fake.members[ctx] = [Member(id: fake.account, nickname: "Ana", joinedAt: 1, updatedAt: 1, account: fake.account, role: "editor")]
        fake.protections[ctx] = [Protection(
            id: "p1", sheetId: "s1", topRowId: "0", leftColId: "0", bottomRowId: "1", rightColId: "1",
            description: "Totals", editors: [], createdBy: "zz")]
        let m = model(fake)
        await m.load()
        XCTAssertEqual(m.editBlock(at: GridPos(row: 1, col: 0)), "Protected: Totals")
        XCTAssertNil(m.editBlock(at: GridPos(row: 3, col: 0)))
    }

    func testCommentsThreadsResolveAndMarkers() async throws {
        let fake = seeded()
        let m = model(fake)
        await m.load()
        let pos = GridPos(row: 1, col: 1)
        try await m.addComment("Is this final?", at: pos)
        XCTAssertEqual(m.grid?.commented, [pos])
        let thread = try XCTUnwrap(m.threads(at: pos).first)
        XCTAssertEqual(m.location(of: thread.root), "B2")
        try await m.reply(to: thread, text: "Yes")
        XCTAssertEqual(m.threads(at: pos).first?.replies.map(\.text), ["Yes"])
        XCTAssertEqual(m.name(of: thread.root.author), "You")
        try await m.setResolved(thread, true)
        XCTAssertTrue(m.openThreads.isEmpty)
        XCTAssertEqual(m.grid?.commented, [])
        try await m.editComment(thread.root, text: "Is this the final number?")
        XCTAssertEqual(m.threads(at: pos).first?.root.text, "Is this the final number?")
        try await m.deleteComment(thread.root)
        XCTAssertTrue(m.threads(at: pos).isEmpty)
    }

    func testWriteFailureKeepsContentAndReportsIt() async {
        let fake = seeded()
        let m = model(fake)
        await m.load()
        fake.failWrites = SheetsError.message("Read-only")
        do {
            try await m.setValue("1", at: GridPos(row: 1, col: 1))
            XCTFail("expected a failure")
        } catch {
            XCTAssertEqual(error as? SheetsError, .message("Read-only"))
        }
        XCTAssertEqual(m.grid?.cells[GridPos(row: 1, col: 1)]?.computed, "1200")
    }
}
