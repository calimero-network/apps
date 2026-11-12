import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import ForumCore

/// The typed client against the component contract's wire: camelCase methods,
/// arguments and fields, 64-bit integers as decimal strings.
final class ContractTests: XCTestCase {
    /// `logic/res/abi.json`'s methods (the web port, calimero-network/apps#715), minus `init`.
    static let abiCalls: Set<String> = [
        "createComment", "createPost", "deleteComment", "deletePost", "editComment", "editPost", "moderateComment",
        "moderatePost", "setModerators", "setNickname", "vote", "voteComment",
    ]
    static let abiViews: Set<String> = ["getNickname", "getPost", "listComments", "listPosts", "moderators"]

    /// The committed ABI when this checkout has the component port, else the lists above.
    private func abi() throws -> (calls: Set<String>, views: Set<String>) {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().appendingPathComponent("../../../../../logic/res/abi.json").standardized
        guard let data = try? Data(contentsOf: url),
            case .object(let root) = try JSONDecoder().decode(JSONValue.self, from: data),
            case .object(let methods)? = root["methods"],
            methods.values.contains(where: { $0["kind"] != nil })
        else { return (Self.abiCalls, Self.abiViews) }
        var calls = Set<String>()
        var views = Set<String>()
        for (name, method) in methods {
            switch method["kind"]?.stringValue {
            case "call": calls.insert(name)
            case "view": views.insert(name)
            default: break
            }
        }
        return (calls, views)
    }

    func testMethodListsMatchTheABI() throws {
        let abi = try abi()
        XCTAssertEqual(Set(ForumContract.calls), abi.calls)
        XCTAssertEqual(Set(ForumContract.views), abi.views)
    }

    func testCallsUseCamelCaseNamesAndArguments() async throws {
        let backend = InMemoryAppBackend(account: String(repeating: "ab", count: 32))
        backend.recording.setHandler { call in call.method == "createComment" ? .string("c1") : .null }
        let client = ForumClient.make(contract: backend.contract, contextId: "app1")
        let id = try await client.createComment(postId: "p1", body: "hi")
        XCTAssertEqual(id, "c1")
        try await client.vote(postId: "p1", value: -1)
        try await client.moderateComment(commentId: "c1")
        XCTAssertEqual(
            backend.recording.calls("createComment").first?.args, .object(["postId": .string("p1"), "body": .string("hi")]))
        XCTAssertEqual(backend.recording.calls("vote").first?.args, .object(["postId": .string("p1"), "value": .number(-1)]))
        XCTAssertEqual(backend.recording.calls("moderateComment").first?.path, .execute)
        XCTAssertEqual(backend.recording.calls("moderateComment").first?.args, .object(["commentId": .string("c1")]))
    }

    func testListPostsDecodesTheComponentAnswer() async throws {
        let wire = #"""
            {"items":[{"id":"p1","author":"acc1","authorName":"Ana","title":"Hello","body":"First",
              "createdAt":"1700000000000","editedAt":"0","score":"-2","commentCount":"3","myVote":-1}],
             "nextCursor":"opaque"}
            """#
        let backend = InMemoryAppBackend(account: String(repeating: "ab", count: 32))
        let answer = try JSONDecoder().decode(JSONValue.self, from: Data(wire.utf8))
        backend.recording.setHandler { _ in answer }
        let client = ForumClient.make(contract: backend.contract, contextId: "app1")
        let page = try await client.listPosts(sort: "top", cursor: nil, limit: 20)
        let call = try XCTUnwrap(backend.recording.calls("listPosts").first)
        XCTAssertEqual(call.path, .query)
        XCTAssertEqual(call.args, .object(["sort": .string("top"), "cursor": .null, "limit": .number(20)]))
        XCTAssertEqual(page.nextCursor, "opaque")
        let post = try XCTUnwrap(page.items.first)
        XCTAssertEqual(post.createdAt, 1_700_000_000_000)
        XCTAssertEqual(post.score, -2)
        XCTAssertEqual(post.commentCount, 3)
        XCTAssertEqual(post.myVote, -1)
        XCTAssertEqual(post.authorName, "Ana")
    }

    func testTheWebAppsInviteLinkParses() throws {
        let link = "https://forum.example/?invite=inv_abc123&forum=app9"
        let invitation = try XCTUnwrap(ForumInvitation.parse(link))
        XCTAssertEqual(invitation.invitation.token, "inv_abc123")
        XCTAssertEqual(invitation.kind, .forum)
        XCTAssertEqual(invitation.contextId, "app9")
        let space = try XCTUnwrap(ForumInvitation.parse("https://forum.example/?invite=inv_abc123"))
        XCTAssertEqual(space.kind, .space)
    }
}
