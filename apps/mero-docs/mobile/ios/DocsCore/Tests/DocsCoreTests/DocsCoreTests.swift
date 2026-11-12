import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import DocsCore

final class DocumentReaderTests: XCTestCase {
    func testDecodesTheNodesSpanShape() throws {
        let rows = try JSONDecoder().decode([WireBlock].self, from: Data(FakeDocs.body.utf8))
        XCTAssertEqual(rows.count, 6)
        XCTAssertEqual(rows[0].spans, [WireSpan(text: "Plan")])
        XCTAssertEqual(rows[1].spans[1].attributes, ["bold": "true", "italic": "true"])
    }

    func testBlocksCarryKindsMarksAndNumbers() throws {
        let rows = try JSONDecoder().decode([WireBlock].self, from: Data(FakeDocs.body.utf8))
        let blocks = DocumentReader.blocks(rows)
        XCTAssertEqual(blocks[0].kind, .heading(level: 2))
        XCTAssertEqual(blocks[1].runs.map(\.text), ["Ship ", "fast", " and ", "read this"])
        XCTAssertTrue(blocks[1].runs[1].bold && blocks[1].runs[1].italic)
        XCTAssertEqual(blocks[1].runs[3].link, "https://example.com")
        XCTAssertEqual(blocks[2].kind, .numbered(index: 1))
        XCTAssertEqual(blocks[3].kind, .numbered(index: 2))
        XCTAssertEqual(blocks[4].kind, .image(blobId: String(repeating: "0f", count: 32), caption: "Chart", name: "", width: nil))
        XCTAssertEqual(blocks[5].kind, .unsupported(kind: "table"))
        XCTAssertEqual(DocumentReader.wordCount(blocks), 9)
    }

    func testNumberingRestartsAfterAnotherBlockAndNestsByDepth() {
        let rows = [
            WireBlock(id: "1", kind: "numberedListItem"),
            WireBlock(id: "2", kind: "numberedListItem", depth: 1),
            WireBlock(id: "3", kind: "numberedListItem", depth: 1),
            WireBlock(id: "4", kind: "numberedListItem"),
            WireBlock(id: "5", kind: "paragraph"),
            WireBlock(id: "6", kind: "numberedListItem"),
        ]
        XCTAssertEqual(
            DocumentReader.blocks(rows).map(\.kind),
            [.numbered(index: 1), .numbered(index: 1), .numbered(index: 2), .numbered(index: 2), .paragraph, .numbered(index: 1)])
    }

    func testAdjacentRunsWithTheSameMarksJoin() {
        let runs = DocumentReader.runs([WireSpan(text: "a"), WireSpan(text: "b"), WireSpan(text: ""), WireSpan(text: "c", attributes: ["code": "true"])])
        XCTAssertEqual(runs.map(\.text), ["ab", "c"])
        XCTAssertTrue(runs[1].code)
    }

    func testOnlyBlobReferencesAreImages() {
        XCTAssertNil(DocumentReader.blobId(fromURL: "https://example.com/a.png"))
        XCTAssertNil(DocumentReader.blobId(fromURL: "blob:abc"))
        XCTAssertEqual(DocumentReader.blobId(fromURL: "blob:" + String(repeating: "a", count: 64)), String(repeating: "a", count: 64))
    }

    func testBlockAttrsDefaultsAndColours() {
        let blocks = DocumentReader.blocks([
            WireBlock(id: "1", kind: "checkListItem", attrs: ["checked": "true", "textAlignment": "center", "textColor": "default"]),
            WireBlock(id: "2", kind: "heading", attrs: [:]),
            WireBlock(id: "3", kind: "codeBlock", attrs: ["language": "rust", "backgroundColor": "blue"]),
        ])
        XCTAssertEqual(blocks[0].kind, .check(checked: true))
        XCTAssertEqual(blocks[0].alignment, .center)
        XCTAssertNil(blocks[0].textColor)
        XCTAssertEqual(blocks[1].kind, .heading(level: 1))
        XCTAssertEqual(blocks[2].kind, .code(language: "rust"))
        XCTAssertEqual(blocks[2].backgroundColor, "blue")
    }
}

final class CommentTests: XCTestCase {
    func testBodiesRoundTrip() {
        XCTAssertEqual(CommentBody.encode("  hi ", blockId: "b1"), "[[block:b1]] hi")
        XCTAssertEqual(CommentBody.encode("ok", replyTo: "c1"), "[[reply:c1]] ok")
        XCTAssertEqual(CommentBody.encode("doc-wide"), "doc-wide")
        let block = CommentBody.parse("[[block:b1]] hi")
        XCTAssertEqual(block.text, "hi")
        XCTAssertEqual(block.blockId, "b1")
        let reply = CommentBody.parse("[[reply:c1]] ok")
        XCTAssertEqual(reply.replyTo, "c1")
        XCTAssertEqual(CommentBody.parse("[[weird]] x").text, "[[weird]] x")
        XCTAssertEqual(CommentBody.parse("plain").text, "plain")
    }

    func testThreadsGroupRepliesUnderTheirRoot() {
        let c = [
            DocComment(id: "r1", author: "a", createdAt: 1, text: "root", blockId: "b1"),
            DocComment(id: "x", author: "b", createdAt: 2, text: "re", replyTo: "r1"),
            DocComment(id: "y", author: "a", createdAt: 3, text: "re re", replyTo: "x"),
            DocComment(id: "r2", author: "b", createdAt: 4, text: "doc"),
            DocComment(id: "z", author: "b", createdAt: 5, text: "orphan", replyTo: "gone"),
        ]
        let threads = CommentBody.threads(c.reversed())
        XCTAssertEqual(threads.map(\.id), ["r1", "r2", "z"])
        XCTAssertEqual(threads[0].replies.map(\.id), ["x", "y"])
        XCTAssertEqual(CommentBody.countsByBlock(threads), ["b1": 3])
    }
}

final class FormatTests: XCTestCase {
    func testDocLinksMatchTheWebAndParseBack() {
        let t = DocTarget(workspaceId: "ws1", folderId: "g1", docId: "d1", blockId: "b9")
        let link = DocsFormat.docLink(t)
        XCTAssertEqual(link, "https://mero-docs.vercel.app/app/ws1/f/g1/d/d1#b=b9")
        XCTAssertEqual(DocsFormat.parseDocLink(link), t)
        XCTAssertEqual(
            DocsFormat.parseDocLink("http://localhost:2428/1.2.0/app/ws1/f/g1/d/d1"),
            DocTarget(workspaceId: "ws1", folderId: "g1", docId: "d1"))
        XCTAssertNil(DocsFormat.parseDocLink("https://mero-docs.vercel.app/app/ws1/f/g1"))
    }

    func testLinkTargets() {
        let member = "/app/ws1/m/" + String(repeating: "AB", count: 32)
        XCTAssertEqual(DocsFormat.linkTarget(member), .member(account: String(repeating: "ab", count: 32)))
        XCTAssertEqual(DocsFormat.linkTarget("https://example.com"), .web(URL(string: "https://example.com")!))
        XCTAssertEqual(DocsFormat.linkTarget("javascript:alert(1)"), LinkTarget.none)
    }

    func testSnippetPieces() {
        let pieces = DocsFormat.snippetPieces("a <b>match</b> &amp; <i>x</i>")
        XCTAssertEqual(pieces.map(\.text), ["a ", "match", " & ", "x"])
        XCTAssertEqual(pieces.map(\.bold), [false, true, false, false])
    }

    func testRelativeTime() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        XCTAssertEqual(DocsFormat.relativeTime(nanos: 1_699_999_990 * 1_000_000_000, now: now), "just now")
        XCTAssertEqual(DocsFormat.relativeTime(nanos: 1_699_996_400 * 1_000_000_000, now: now), "1h ago")
        XCTAssertEqual(DocsFormat.relativeTime(nanos: 0, now: now), "")
    }
}

final class MemoryRecents: RecentStore, @unchecked Sendable {
    var list: [String: [RecentDoc]] = [:]
    func recent(workspaceId: String) -> [RecentDoc] { list[workspaceId] ?? [] }
    func touch(workspaceId: String, folderId: String, docId: String, at: Date) {
        list[workspaceId, default: []].removeAll { $0.folderId == folderId && $0.docId == docId }
        list[workspaceId, default: []].insert(RecentDoc(folderId: folderId, docId: docId, openedAt: 0), at: 0)
    }
}

@MainActor
final class ModelTests: XCTestCase {
    func testWorkspacesAreNamedAndSorted() async {
        let fake = FakeDocs()
        fake.backend.namespaces = [
            AppNamespace(id: "z", name: "Zeta", applicationId: "a"),
            AppNamespace(id: String(repeating: "f", count: 64), name: " ", applicationId: "a"),
        ]
        let model = WorkspacesModel(backend: fake.backend)
        await model.load()
        XCTAssertEqual(model.workspaces.map(\.name), ["Workspace ffff…ffff", "Zeta"])
        XCTAssertEqual(model.state, .loaded)
    }

    func testWorkspaceWalksTheTreeJoinsOpenFoldersAndListsDocs() async {
        let fake = FakeDocs()
        fake.standardWorkspace()
        let model = WorkspaceModel(backend: fake.backend, workspace: Workspace(id: FakeDocs.ws, name: "Acme", memberCount: 3), recents: MemoryRecents())
        await model.load()
        XCTAssertEqual(model.state, .loaded)
        XCTAssertEqual(model.folders(in: nil).map(\.name), ["Notes", "Product"])
        XCTAssertEqual(model.folders(in: "g-product").map(\.name), ["Specs"])
        XCTAssertEqual(model.recentlyUpdated.map(\.title), ["Standup notes", "Roadmap", "API spec"])
        XCTAssertTrue(fake.backend.log.contains("joinContext c-specs"))
        XCTAssertEqual(model.docs(in: "g-specs").first?.contextId, "c-specs")
    }

    func testAFolderThatFailsIsReportedNotFatal() async {
        let fake = FakeDocs()
        fake.standardWorkspace()
        fake.on("listDocs", in: "c-notes") { _ in "{\"oops\":1}" }
        let model = WorkspaceModel(backend: fake.backend, workspace: Workspace(id: FakeDocs.ws, name: "Acme", memberCount: 3), recents: MemoryRecents())
        await model.load()
        XCTAssertEqual(model.state, .loaded)
        XCTAssertNotNil(model.issues["g-notes"])
        XCTAssertEqual(model.docs.count, 2)
    }

    func testSearchRanksIndexHitsThenTitleMatches() async {
        let fake = FakeDocs()
        fake.standardWorkspace()
        fake.on("searchDocs", in: "c-specs", json: #"{"hits":[{"id":"d3","title":"API spec","snippet":"the <b>road</b>","score":2.0,"archived":false}],"total":1,"nextCursor":null}"#)
        fake.on("searchDocs", json: #"{"hits":[],"total":0}"#)
        let model = WorkspaceModel(backend: fake.backend, workspace: Workspace(id: FakeDocs.ws, name: "Acme", memberCount: 3), recents: MemoryRecents())
        await model.load()
        await model.search("road")
        XCTAssertEqual(model.results.map(\.row.title), ["API spec", "Roadmap"])
        XCTAssertEqual(model.results.first?.snippet, "the <b>road</b>")
        let call = fake.backend.recording.calls("searchDocs").first
        XCTAssertEqual(call?.args["query"]?.stringValue, "road")
        XCTAssertEqual(call?.path, .query)
        await model.search("")
        XCTAssertTrue(model.results.isEmpty)
    }

    func testDocumentOpensReadsBodyAndCommentsAndRecordsRecent() async {
        let fake = FakeDocs()
        fake.standardWorkspace()
        fake.on("getDoc", json: FakeDocs.doc("d1", "Roadmap", updated: 1))
        fake.on("getDocument", json: FakeDocs.body)
        fake.on(
            "listComments",
            json: "[\(FakeDocs.comment("c1", "[[block:b2]] Why fast?", at: 1)),\(FakeDocs.comment("c2", "[[reply:c1]] Because", author: FakeDocs.me, at: 2))]")
        let recents = MemoryRecents()
        let model = DocumentModel(
            backend: fake.backend, workspaceId: FakeDocs.ws, folderId: "g-product", docId: "d1", recents: recents)
        await model.open()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.contextId, "c-product")
        XCTAssertEqual(model.title, "Roadmap")
        XCTAssertEqual(model.blocks.count, 6)
        XCTAssertEqual(model.threads.count, 1)
        XCTAssertEqual(model.threads[0].root.blockId, "b2")
        XCTAssertEqual(model.countsByBlock, ["b2": 2])
        XCTAssertEqual(personName(model.threads[0].replies[0].author, me: model.account), "You")
        XCTAssertEqual(recents.recent(workspaceId: FakeDocs.ws).first?.docId, "d1")
        XCTAssertEqual(model.shareLink, "https://mero-docs.vercel.app/app/\(FakeDocs.ws)/f/g-product/d/d1")
        // Reads only: opening a document writes nothing.
        XCTAssertTrue(fake.backend.recording.calls.allSatisfy { $0.path == .query })
    }

    func testCommentingSendsThePrefixedBodyAndShowsItAtOnce() async throws {
        let fake = FakeDocs()
        fake.standardWorkspace()
        fake.on("getDoc", json: FakeDocs.doc("d1", "Roadmap", updated: 1))
        fake.on("getDocument", json: FakeDocs.body)
        fake.on("listComments", json: "[]")
        fake.on("addComment", json: "\"new1\"")
        let model = DocumentModel(
            backend: fake.backend, workspaceId: FakeDocs.ws, folderId: "g-product", docId: "d1", contextId: "c-product")
        await model.open()
        try await model.addComment("  Looks good ", blockId: "b3")
        let call = try XCTUnwrap(fake.backend.recording.calls("addComment").first)
        XCTAssertEqual(call.path, .execute)
        XCTAssertEqual(call.contextId, "c-product")
        XCTAssertEqual(call.args["body"]?.stringValue, "[[block:b3]] Looks good")
        XCTAssertEqual(call.args["docId"]?.stringValue, "d1")
        XCTAssertEqual(model.threads.map(\.root.text), ["Looks good"])
        try await model.reply(to: "new1", "Thanks")
        XCTAssertEqual(fake.backend.recording.calls("addComment").last?.args["body"]?.stringValue, "[[reply:new1]] Thanks")
    }

    func testDocumentInAFolderWithNoContextFails() async {
        let fake = FakeDocs()
        fake.standardWorkspace()
        let model = DocumentModel(backend: fake.backend, workspaceId: FakeDocs.ws, folderId: "g-missing", docId: "d1")
        await model.open()
        XCTAssertEqual(model.phase, .failed(DocsError.folderNotReady.errorDescription!))
    }

    func testImagesLoadThroughTheBlobLoader() async {
        struct Blobs: BlobLoading {
            func blob(id: String, contextId: String) async throws -> Data { Data("\(contextId)/\(id)".utf8) }
        }
        let fake = FakeDocs()
        let model = DocumentModel(
            backend: fake.backend, workspaceId: "w", folderId: "g", docId: "d", contextId: "c", blobs: Blobs())
        await model.loadImage("ab")
        XCTAssertEqual(model.images["ab"], .loaded(Data("c/ab".utf8)))
        let none = DocumentModel(backend: fake.backend, workspaceId: "w", folderId: "g", docId: "d", contextId: "c")
        await none.loadImage("ab")
        XCTAssertEqual(none.images["ab"], .unavailable)
    }
}

final class ErrorTextTests: XCTestCase {
    func testCalimero10ErrorsReadAsWords() {
        XCTAssertEqual(DocsFormat.errorText(LoginRequired("expired")), "Your session ended. Sign in again.")
        XCTAssertEqual(DocsFormat.errorText(SignedOutError(method: "getDocument")), "Your session ended. Sign in again.")
        XCTAssertEqual(DocsFormat.errorText(ConfirmCancelled()), "The passkey prompt was cancelled. Nothing changed.")
        XCTAssertTrue(DocsFormat.errorText(WrongNode("x")).hasPrefix("This node doesn't serve your account."))
        XCTAssertTrue(
            DocsFormat.errorText(ReleaseDeadlineError("x", details: ["release": .string("1.2.0")]))
                .contains("release 1.2.0"))
        XCTAssertTrue(DocsFormat.errorText(ConsentStale("x")).contains("out of date"))
        XCTAssertTrue(
            DocsFormat.errorText(CalimeroError(status: 403, code: "FORBIDDEN", message: "read only"))
                .hasPrefix("You can read this folder but not comment"))
    }

    func testContractRefusalsReadAsWords() {
        func app(_ code: String, _ message: String) -> AppError {
            AppError("", details: ["code": .string(code), "fields": .object(["message": .string(message)])])
        }
        XCTAssertEqual(DocsFormat.errorText(app("NotFound", "no doc")), "This document or comment is gone. Pull to refresh.")
        XCTAssertEqual(DocsFormat.errorText(app("Forbidden", "")), "You can't do that in this folder.")
        XCTAssertEqual(DocsFormat.errorText(app("Invalid", "empty comment")), "That wasn't accepted: empty comment")
        XCTAssertEqual(DocsFormat.errorText(app("Other", "")), "Other")
    }
}

final class WireTests: XCTestCase {
    func testDocViewTimestampsAreMillisecondStrings() throws {
        let json = #"{"id":"doc-1","title":"T","tags":["k"],"archived":false,"createdAt":"1700000000123","updatedAt":"1700000000456","createdBy":"a","updatedBy":"b","canDelete":true}"#
        let doc = try JSONDecoder().decode(DocDto.self, from: Data(json.utf8))
        XCTAssertEqual(doc.createdAt, 1_700_000_000_123)
        XCTAssertEqual(doc.updatedAt, 1_700_000_000_456)
        // The screens show them in nanoseconds, as the web adapter does.
        XCTAssertEqual(DocsFormat.nanos(millis: doc.updatedAt), 1_700_000_000_456_000_000)
        XCTAssertTrue(doc.canDelete)
        // The demo writes the same wire shape back.
        let again = try JSONDecoder().decode(DocDto.self, from: try JSONEncoder().encode(doc))
        XCTAssertEqual(again, doc)
        let object = try JSONSerialization.jsonObject(with: try JSONEncoder().encode(doc)) as? [String: Any]
        XCTAssertEqual(object?["updatedAt"] as? String, "1700000000456")
    }

    func testSearchPageTotalIsADecimalString() throws {
        let page = try JSONDecoder().decode(
            DocSearchPage.self, from: Data(#"{"hits":[],"total":"12","nextCursor":20}"#.utf8))
        XCTAssertEqual(page.total, 12)
        XCTAssertEqual(page.nextCursor, 20)
    }

    func testFoldersComeFromTheOrgsTeams() {
        let org = OrgInfo(
            json: .object([
                "orgId": .string("org1"), "name": .string("Acme"),
                "teams": .object([
                    "t-product": .object([
                        "teamId": .string("t-product"), "name": .string("Product"), "join": .string("everyone"),
                        "metadata": .object(["docsApp": .string("app-product"), "color": .string("blue")]),
                    ]),
                    "t-specs": .object([
                        "teamId": .string("t-specs"), "name": .string("Specs"), "parent": .string("t-product"),
                        "join": .string("invite"), "metadata": .object(["docsApp": .string("app-specs")]),
                    ]),
                    // Its parent is a team the caller does not see: it sits at the top.
                    "t-shared": .object([
                        "teamId": .string("t-shared"), "name": .string("Board"), "parent": .string("t-hidden"),
                        "join": .string("invite"), "metadata": .object([:]),
                    ]),
                ]),
            ]))
        let folders = DocsDirectory.folders(of: org)
        XCTAssertEqual(folders.map(\.id), ["t-product", "t-shared", "t-specs"])
        XCTAssertEqual(folders.first { $0.id == "t-specs" }?.parentId, "t-product")
        XCTAssertEqual(folders.first { $0.id == "t-specs" }?.contextId, "app-specs")
        XCTAssertNil(folders.first { $0.id == "t-shared" }?.parentId)
        XCTAssertNil(folders.first { $0.id == "t-shared" }?.contextId)
    }

    /// Every method the client calls is in the component ABI, by name. Skipped
    /// while `logic/res/abi.json` is still the v1 ABI (before the web port lands).
    func testClientMethodsAreInTheComponentABI() throws {
        let abi = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("logic/res/abi.json")
        guard let data = try? Data(contentsOf: abi),
            let root = try JSONSerialization.jsonObject(with: data) as? [String: Any], root["abiVersion"] != nil,
            let methods = root["methods"] as? [String: [String: Any]]
        else { throw XCTSkip("logic/res/abi.json is not the component ABI yet") }
        for name in DocsClient.methods {
            XCTAssertNotNil(methods[name], "\(name) is not in the ABI")
        }
        XCTAssertEqual(methods["listDocs"]?["kind"] as? String, "view")
        XCTAssertEqual(methods["addComment"]?["kind"] as? String, "call")
        let params = (methods["addComment"]?["params"] as? [[String]])?.map { $0[0] }
        XCTAssertEqual(params, ["docId", "body"])
    }
}
