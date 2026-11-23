import MeroKit
import MeroKitTestSupport
import XCTest

@testable import SheetsCore

/// The client speaks the component contract's wire (`logic/res/abi.json`):
/// camelCase method and argument names, u64 values as decimal strings.
final class WireTests: XCTestCase {
    func testCallsUseCamelCaseMethodsAndArguments() async throws {
        let backend = InMemoryAppBackend(account: "acct_1")
        let client = SheetsClient(contract: backend.contract, contextId: "app-1")
        _ = try? await client.setCell(sheetId: "s1", rowId: "r1", colId: "c1", rawValue: "42")
        let call = try XCTUnwrap(backend.recording.calls("setCell").first)
        XCTAssertEqual(call.path, .execute)
        let args = try XCTUnwrap(
            JSONSerialization.jsonObject(with: try XCTUnwrap(call.argsJSON)) as? [String: String])
        XCTAssertEqual(args, ["sheetId": "s1", "rowId": "r1", "colId": "c1", "rawValue": "42"])

        _ = try? await client.getAllCells()
        XCTAssertEqual(backend.recording.calls("getAllCells").first?.path, .query)
    }

    func testU64GoesOutAsADecimalString() async throws {
        let backend = InMemoryAppBackend(account: "acct_1")
        let client = SheetsClient(contract: backend.contract, contextId: "app-1")
        _ = try? await client.getActivity(since: 18_446_744_073_709_551_615, limit: 5)
        let call = try XCTUnwrap(backend.recording.calls("getActivity").first)
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(call.argsJSON)) as? [String: Any])
        XCTAssertEqual(args["since"] as? String, "18446744073709551615")
        XCTAssertEqual(args["limit"] as? Int, 5)
    }

    func testAnswersReadU64FromDecimalStrings() throws {
        let json = #"""
            {"id":"s1|r|c","sheet_id":"s1","row_id":"r","col_id":"c","raw_value":"7","computed_value":"7",
             "format":"","updated_at":"1700000000000000000","last_editor":"acct_1","last_edited_at":"5"}
            """#
        let cell = try JSONDecoder().decode(Cell.self, from: Data(json.utf8))
        XCTAssertEqual(cell.updatedAt, 1_700_000_000_000_000_000)
        XCTAssertEqual(cell.lastEditedAt, 5)
        // A bare number still reads.
        let member = try JSONDecoder().decode(
            Member.self,
            from: Data(
                #"{"id":"acct_1","nickname":"Ada","joined_at":3,"updated_at":"4","account":"acct_1","role":"owner"}"#.utf8))
        XCTAssertEqual(member.joinedAt, 3)
        XCTAssertEqual(member.updatedAt, 4)
    }
}
