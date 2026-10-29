import XCTest

@testable import SheetsCore

final class GridTests: XCTestCase {
    func testColumnLabels() {
        XCTAssertEqual(A1.column(0), "A")
        XCTAssertEqual(A1.column(25), "Z")
        XCTAssertEqual(A1.column(26), "AA")
        XCTAssertEqual(A1.column(701), "ZZ")
        XCTAssertEqual(A1.columnIndex("AA"), 26)
        XCTAssertEqual(A1.cell(row: 2, col: 1), "B3")
        XCTAssertEqual(A1.sheetPrefix("Data"), "Data!")
        XCTAssertEqual(A1.sheetPrefix("Q3 Budget"), "'Q3 Budget'!")
        XCTAssertEqual(A1.sheetPrefix("Bob's"), "'Bob''s'!")
    }

    func testImplicitAxis() {
        let axis = AxisOrder(entries: [], length: 5)
        XCTAssertEqual(axis.ids, ["0", "1", "2", "3", "4"])
        XCTAssertEqual(axis.position(of: "3"), 3)
        XCTAssertNil(axis.position(of: "03"))
    }

    func testInsertedAndDeletedRows() {
        // A row added between implicit rows 1 and 2, and implicit row 0 deleted.
        let entries = [
            AxisEntryView(id: "k1", pos: "5000000001" + "5", deleted: false),
            AxisEntryView(id: "0", pos: "", deleted: true),
        ]
        let axis = AxisOrder(entries: entries, length: 4)
        XCTAssertEqual(axis.ids, ["1", "k1", "2", "3"])
        XCTAssertEqual(axis.position(of: "k1"), 1)
        XCTAssertNil(axis.position(of: "0"))
    }

    func testFormulaDisplay() {
        let plain = SheetOrder(layout: nil)
        let moved = SheetOrder(
            layout: SheetLayout(
                sheetId: "s1", rows: [AxisEntryView(id: "k1", pos: "4", deleted: false)], cols: []))
        let orders = { (id: String) in id == "s1" ? moved : plain }
        let names = { (id: String) -> String? in id == "s2" ? "Q3 Budget" : id == "s3" ? "Data" : nil }
        func show(_ f: String) -> String { FormulaDisplay.display(f, home: "s1", orders: orders, sheetName: names) }
        // A row inserted before row 0 pushes every implicit row down by one.
        XCTAssertEqual(show("=SUM(A1:A3)"), "=SUM(A2:A4)")
        XCTAssertEqual(show("={r=k1;c=0}*2"), "=A1*2")
        XCTAssertEqual(show("={$r=k1;$c=1}+$B$1"), "=$B$1+$B$2")
        XCTAssertEqual(show("=[s2]!B2+[s3]!A1"), "='Q3 Budget'!B2+Data!A1")
        XCTAssertEqual(show(#"=CONCAT("A1", B1)"#), #"=CONCAT("A1", B2)"#)
        XCTAssertEqual(show("=LOG10(A1)"), "=LOG10(A2)")
        XCTAssertEqual(show("=SUM(B:B)"), "=SUM(B:B)")
        XCTAssertEqual(show("={r=gone;c=0}"), "=#REF!")
        XCTAssertEqual(show("plain"), "plain")
    }

    func testGridMetrics() {
        let cells = [GridPos(row: 4, col: 2): GridCell(
            pos: GridPos(row: 4, col: 2), rowId: "4", colId: "2", raw: "x", computed: "x", format: "", text: "x",
            look: CellLook(), lastEditor: "", lastEditedAt: 0)]
        let grid = SheetGrid(
            sheetId: "s", order: SheetOrder(layout: nil), cells: cells,
            sizes: [AxisSize(axis: "col", id: "1", size: 40)], frozenRows: 1, frozenCols: 1)
        XCTAssertEqual(grid.rowCount, 60)
        XCTAssertEqual(grid.colCount, 12)
        XCTAssertEqual(grid.width(1), 40)
        XCTAssertEqual(grid.colOffsets[2], 140)
        XCTAssertEqual(grid.col(at: 139), 1)
        XCTAssertEqual(grid.col(at: 140), 2)
        XCTAssertEqual(grid.row(at: 47.9), 1)
        XCTAssertEqual(grid.frozenHeight, 24)
    }
}
