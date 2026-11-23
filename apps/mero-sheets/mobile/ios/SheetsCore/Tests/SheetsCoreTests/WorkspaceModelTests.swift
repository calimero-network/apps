import MeroKit
import MeroKitTestSupport
import XCTest

@testable import SheetsCore

@MainActor
final class WorkspaceModelTests: XCTestCase {
    private func model(_ fake: FakeSheets, store: SheetsStore = MemorySheetsStore()) -> WorkspaceModel {
        WorkspaceModel(backend: fake.backend, applicationId: fake.backend.applicationId, store: store)
    }

    func testLoadOpensRememberedWorkspaceAndNamesSpreadsheetsFromTheWorkbook() async {
        let fake = FakeSheets()
        let a = String(repeating: "1", count: 64)
        let b = String(repeating: "2", count: 64)
        fake.backend.namespaces = [
            AppNamespace(id: a, name: "Alpha", applicationId: "app"), AppNamespace(id: b, name: "Beta", applicationId: "app"),
        ]
        fake.backend.rootContexts = [b: ["ctx-1", "ctx-2"]]
        fake.seedProject("Q3 Budget", in: "ctx-1")
        let store = MemorySheetsStore()
        store.activeWorkspace = b
        let m = model(fake, store: store)
        await m.load()
        XCTAssertEqual(m.phase, .loaded)
        XCTAssertEqual(m.workspaces.map(\.name), ["Alpha", "Beta"])
        XCTAssertEqual(m.activeWorkspaceId, b)
        XCTAssertEqual(m.spreadsheets.map(\.name), ["Q3 Budget", "Untitled · ctx-2"])
        XCTAssertEqual(m.spreadsheets.map(\.unnamed), [false, true])
    }

    func testCreateWorkspaceThenSpreadsheetInitsTheWorkbook() async throws {
        let fake = FakeSheets()
        let m = model(fake)
        await m.load()
        XCTAssertTrue(m.workspaces.isEmpty)
        let notice = try await m.createWorkspace(name: "  Finance ")
        XCTAssertNil(notice)
        XCTAssertEqual(m.activeWorkspace?.name, "Finance")
        XCTAssertTrue(fake.backend.log.contains("foundNamespace Finance"))

        let id = try await m.createSpreadsheet(name: " Q3 Budget ")
        XCTAssertEqual(fake.project(id), "Q3 Budget")
        XCTAssertEqual(fake.sheetNames(id), ["Sheet 1"])
        XCTAssertEqual(m.spreadsheet(id)?.name, "Q3 Budget")
        XCTAssertEqual(fake.backend.initArgs[id], .object([:]))
    }

    func testCreateNeedsNames() async {
        let fake = FakeSheets()
        let m = model(fake)
        do {
            try await m.createSpreadsheet(name: " ")
            XCTFail("expected a failure")
        } catch {
            XCTAssertEqual(error as? SheetsError, .message("Give the spreadsheet a name."))
        }
    }

    func testHostingNoticeWhenNotHosted() async throws {
        let fake = FakeSheets()
        fake.backend.haEnabled = false
        let m = model(fake)
        let notice = try await m.createWorkspace(name: "Solo")
        XCTAssertNotNil(notice)
    }

    func testInviteLinkRoundTripsAndJoinOpensWorkspace() async throws {
        let inviter = FakeSheets()
        let m = model(inviter)
        _ = try await m.createWorkspace(name: "Finance")
        let id = try await m.createSpreadsheet(name: "Q3 Budget")
        let link = try await m.inviteLink(spreadsheet: m.spreadsheet(id))
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-sheets/join?invitation="))
        let parsed = try XCTUnwrap(SheetsInvitation.parse(link))
        XCTAssertEqual(parsed.workspaceName, "Finance")
        XCTAssertEqual(parsed.contextId, id)
        XCTAssertEqual(parsed.spreadsheetName, "Q3 Budget")

        let joiner = FakeSheets(account: String(repeating: "cd", count: 32))
        let store = MemorySheetsStore()
        let other = model(joiner, store: store)
        try await other.join(parsed)
        XCTAssertEqual(other.activeWorkspaceId, parsed.namespaceId)
        XCTAssertEqual(store.activeWorkspace, parsed.namespaceId)
        XCTAssertTrue(other.isSyncing)
    }

    func testFailureIsWorded() async {
        let fake = FakeSheets()
        fake.backend.failure = URLError(.notConnectedToInternet)
        let m = model(fake)
        await m.load()
        XCTAssertEqual(m.phase, .failed("You are offline. Check your connection and try again."))
    }

    func testEnsureMemberJoinsWhenNotAMember() async {
        let fake = FakeSheets()
        let m = model(fake)
        await m.ensureMember("ctx-9")
        XCTAssertTrue(fake.backend.log.contains("joinContext ctx-9"))
    }
}
