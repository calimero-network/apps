import MeroKit
import XCTest

@testable import SheetsCore

final class FormatTests: XCTestCase {
    func testNumberFormatsMatchWeb() {
        XCTAssertEqual(CellFormat.display("1234.5", format: "number"), "1,234.50")
        XCTAssertEqual(CellFormat.display("1234.5", format: "number:0"), "1,235")
        XCTAssertEqual(CellFormat.display("1234.5", format: "currency"), "$1,234.50")
        XCTAssertEqual(CellFormat.display("1234.5", format: "currency:EUR:0"), "€1,235")
        XCTAssertEqual(CellFormat.display("0.256", format: "percent:1"), "25.6%")
        XCTAssertEqual(CellFormat.display("0.25", format: "percent"), "25%")
        XCTAssertEqual(CellFormat.display("hello", format: "number"), "hello")
        XCTAssertEqual(CellFormat.display("#REF!", format: "currency"), "#REF!")
        XCTAssertEqual(CellFormat.display("", format: "number"), "")
        XCTAssertEqual(CellFormat.display("42", format: ""), "42")
    }

    func testDateFormats() {
        XCTAssertEqual(CellFormat.display("2024-03-05", format: "date"), "2024-03-05")
        XCTAssertEqual(CellFormat.display("2024-03-05", format: "date:us"), "03/05/2024")
        XCTAssertEqual(CellFormat.display("2024-03-05", format: "date:eu"), "05/03/2024")
        XCTAssertEqual(CellFormat.display("2024-03-05", format: "date:long"), "5 March 2024")
        XCTAssertEqual(CellFormat.display("soon", format: "date"), "soon")
    }

    func testDescribe() {
        XCTAssertEqual(CellFormat.describe(""), "Automatic")
        XCTAssertEqual(CellFormat.describe("currency:eur:1"), "Currency (EUR, 1 decimal)")
        XCTAssertEqual(CellFormat.describe("date:eu"), "Date (DD/MM/YYYY)")
    }

    func testCellLook() {
        let look = CellLook(style: ["bold": "1", "color": "#ff0000", "fill": "#0f0", "align": "center", "wrap": ""])
        XCTAssertTrue(look.bold)
        XCTAssertEqual(look.color, 0xFF0000)
        XCTAssertEqual(look.fill, 0x00FF00)
        XCTAssertEqual(look.align, "center")
        XCTAssertFalse(look.wrap)
        XCTAssertTrue(CellLook(style: [:]).isPlain)
    }

    func testAgo() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let ns: (Double) -> UInt64 = { UInt64((1_700_000_000 - $0) * 1_000_000_000) }
        XCTAssertEqual(SheetsFormat.ago(ns: ns(10), now: now), "just now")
        XCTAssertEqual(SheetsFormat.ago(ns: ns(300), now: now), "5 min ago")
        XCTAssertEqual(SheetsFormat.ago(ns: ns(7200), now: now), "2 h ago")
        XCTAssertEqual(SheetsFormat.ago(ns: 0, now: now), "")
    }

    func testChartModel() {
        let data: [[String]] = [["Month", "Sales", "Cost"], ["Jan", "10", "4"], ["Feb", "x", "5"]]
        let m = ChartModel(top: 0, left: 0, bottom: 2, right: 2) { data[$0][$1] }
        XCTAssertEqual(m.labels, ["Jan", "Feb"])
        XCTAssertEqual(m.series.map(\.name), ["Sales", "Cost"])
        XCTAssertEqual(m.series[0].values, [10, nil])
        let single = ChartModel(top: 1, left: 1, bottom: 2, right: 1) { data[$0][$1] }
        XCTAssertEqual(single.labels, ["2", "3"])
        XCTAssertEqual(single.series.map(\.name), ["B"])
        XCTAssertEqual(ChartModel.niceTicks(min: 0, max: 9), [0, 2, 4, 6, 8, 10])
        XCTAssertEqual(ChartModel.formatTick(1_500_000), "1.5M")
        XCTAssertEqual(ChartModel.formatTick(1234.567), "1,234.57")
    }
}

final class ErrorTextTests: XCTestCase {
    func testCalimero10ErrorsReadAsWords() {
        XCTAssertEqual(SheetsFormat.errorText(SignedOutError(method: "get_cells")), "You're signed out. Sign in again.")
        XCTAssertEqual(SheetsFormat.errorText(LoginRequired("expired")), "Your session ended. Sign in again.")
        XCTAssertEqual(SheetsFormat.errorText(AppError("Sheet not found")), "Sheet not found")
    }
}
