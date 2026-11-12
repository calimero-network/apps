import Foundation
import MeroKit
import XCTest

@testable import UpdatesCore

/// The generated client's calls reach the contract as its component ABI takes them, and its
/// answers read back into the v1 types.
final class ComponentWireTests: XCTestCase {
    func testEveryClientMethodIsInTheABI() async throws {
        let wire = Recorder()
        let client = UpdatesClient(contract: wire)
        let input = UpdateInput(
            title: "Oct", summary: "s", categoryId: "c", sections: [], metrics: [],
            asks: [AskInput(kind: "intro", title: "t", detail: "d")])
        _ = try? await client.getMe()
        _ = try? await client.getOverview()
        _ = try? await client.getSettings()
        _ = try? await client.getEngagement()
        _ = try? await client.getPost(postId: "p")
        _ = try? await client.listAsks()
        _ = try? await client.listCategories()
        _ = try? await client.listComments(postId: "p")
        _ = try? await client.listContributions(since: 42)
        _ = try? await client.listDrafts()
        _ = try? await client.listMetrics()
        _ = try? await client.listPeople()
        _ = try? await client.listPosts(limit: 20)
        _ = try? await client.addComment(postId: "p", body: "b")
        try? await client.addTeammate(account: "a")
        try? await client.archiveCategory(categoryId: "c")
        _ = try? await client.askQuestion(title: "t", body: "b")
        _ = try? await client.createCategory(name: "n", emoji: "e", color: "c")
        try? await client.deleteComment(commentId: "c")
        try? await client.deleteDraft(draftId: "d")
        try? await client.deletePost(postId: "p")
        try? await client.editCategory(categoryId: "c", name: "n", emoji: "e", color: "c")
        try? await client.editComment(commentId: "c", body: "b")
        try? await client.editUpdate(postId: "p", input: try .wire(input))
        try? await client.markRead(postId: "p")
        try? await client.offerHelp(askId: "a", note: "n")
        _ = try? await client.publishUpdate(input: try .wire(input))
        try? await client.react(postId: "p", emoji: "e", on: true)
        try? await client.removeTeammate(account: "a")
        _ = try? await client.saveDraft(title: "t", payload: "{}")
        try? await client.setAskStatus(askId: "a", status: "resolved")
        try? await client.setMutedCategories(categoryIds: ["c"])
        try? await client.setOfferStatus(askId: "a", account: "b", status: "accepted")
        try? await client.setProfile(name: "n", firm: "f")
        try? await client.setQuestionStatus(postId: "p", status: "answered")
        try? await client.setSettings(companyName: "Acme", cadenceDays: 14)
        try? await client.withdrawOffer(askId: "a")

        XCTAssertEqual(Set(wire.sent.map(\.method)), Set(ComponentWire.methods.keys))
        for call in wire.sent {
            let spec = try XCTUnwrap(ComponentWire.methods[call.method])
            XCTAssertEqual(call.view, spec.view, call.method)
            XCTAssertEqual(Set(call.args.keys), Set(spec.params), call.method)
        }
        let since = try XCTUnwrap(wire.sent.first { $0.method == "listContributions" }?.args["since"] as? String)
        XCTAssertEqual(since, "42")
        let draft = try XCTUnwrap(wire.sent.first { $0.method == "saveDraft" })
        XCTAssertTrue(draft.args["draftId"] is NSNull)
        let published = try XCTUnwrap(wire.sent.first { $0.method == "publishUpdate" }?.args["input"] as? [String: Any])
        XCTAssertEqual(published["categoryId"] as? String, "c")
    }

    func testAnswersComeBackInTheClientsShape() throws {
        let answer = #"""
            {"items":[{"id":"p1","kind":"update","author":"a","authorName":"Ana","authorIsTeam":true,"title":"Oct",
              "summary":"s","categoryId":"c","status":"","createdAt":"1767225600000","editedAt":"0",
              "commentCount":"3","askCount":"1","openAskCount":"1","metricCount":"0","readCount":"2","readByMe":false,
              "reactions":[{"emoji":"e","count":"4","mine":true}]}],"nextCursor":null}
            """#
        let page = try JSONDecoder().decode(PostPage.self, from: try ComponentWire.incoming(Data(answer.utf8)))
        XCTAssertEqual(page.items[0].createdAt, 1_767_225_600_000)
        XCTAssertEqual(page.items[0].commentCount, 3)
        XCTAssertEqual(page.items[0].reactions[0].count, 4)
        XCTAssertEqual(page.items[0].authorName, "Ana")
        XCTAssertNil(page.nextCursor)
        // A metric's value is not a u64 field: an all-digit string stays a string.
        let point = try JSONDecoder().decode(
            MetricPoint.self,
            from: try ComponentWire.incoming(Data(#"{"postId":"p","postTitle":"t","at":"5","value":"12"}"#.utf8)))
        XCTAssertEqual(point.value, "12")
        XCTAssertEqual(point.at, 5)
    }
}

private final class Recorder: MeroKit.ContextContractCalling, @unchecked Sendable {
    struct Sent {
        let method: String
        let view: Bool
        let args: [String: Any]
    }

    private let lock = NSLock()
    private var log: [Sent] = []
    var sent: [Sent] { lock.withLock { log } }

    func query(method: String, argsJSON: Data) async throws -> Data { record(method, argsJSON, view: true) }
    func execute(method: String, argsJSON: Data) async throws -> Data { record(method, argsJSON, view: false) }

    private func record(_ method: String, _ args: Data, view: Bool) -> Data {
        let parsed = (try? JSONSerialization.jsonObject(with: args)) as? [String: Any] ?? [:]
        lock.withLock { log.append(Sent(method: method, view: view, args: parsed)) }
        return Data("null".utf8)
    }
}
