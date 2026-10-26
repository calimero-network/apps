import MeroKit
import XCTest

/// The contract methods behind threads, mentions, search, drafts, channel
/// settings and roles: names, argument shapes, query vs warrant, results.
final class ChatAPIExtrasTests: XCTestCase {
    private let ctx = ChatFixtures.channelId
    private let fixedNow = Date(timeIntervalSince1970: 1_760_000_123)

    private func makeAPI(_ handler: @escaping RecordingChatContract.Handler) -> (ChatAPI, RecordingChatContract) {
        let contract = RecordingChatContract(handler: handler)
        let now = fixedNow
        return (ChatAPI(contract: contract, now: { now }), contract)
    }

    func testAThreadReplyNamesItsParentAndItsMentions() async throws {
        let (api, contract) = makeAPI { _ in ["id": "r1", "text": "hi", "timestamp": 1] }
        try await api.sendMessage(
            ctx, text: "hi @ana", parentMessage: "p1", mentions: ["ANA58"], mentionsUsernames: ["ana"])
        let call = try XCTUnwrap(contract.calls.first)
        XCTAssertEqual(call.path, .execute)
        XCTAssertEqual(
            call.args,
            [
                "message": "hi @ana", "mentions": ["ANA58"], "mentions_usernames": ["ana"], "parent_message": "p1",
                "timestamp": 1_760_000_123,
            ])
    }

    func testEditAndDeleteInAThreadNameTheParentAndOtherwiseLeaveItOut() {
        XCTAssertEqual(
            ChatAPI.editMessageArgs(messageId: "m", text: "t", timestamp: 5, parentId: "p"),
            ["message_id": "m", "new_message": "t", "timestamp": 5, "parent_id": "p"])
        XCTAssertEqual(ChatAPI.editMessageArgs(messageId: "m", text: "t", timestamp: 5)["parent_id"], nil)
        XCTAssertEqual(ChatAPI.deleteMessageArgs(messageId: "m", parentId: "p"), ["message_id": "m", "parent_id": "p"])
        XCTAssertEqual(ChatAPI.deleteMessageArgs(messageId: "m"), ["message_id": "m"])
    }

    func testAThreadIsReadWithGetMessagesUnderItsParent() async throws {
        let (api, contract) = makeAPI { _ in JSONValue.parse(ChatFixtures.pageJSON(total: 1, indices: [0], offset: 0)) }
        _ = try await api.getMessages(ctx, limit: 20, offset: 0, parentMessage: "p1")
        XCTAssertEqual(contract.calls.first?.args["parent_message"], "p1")
        XCTAssertEqual(contract.calls.first?.path, .query)
    }

    func testSearchSendsANullCursorFirstAndReadsHitsAndTheNextCursor() async throws {
        let (api, contract) = makeAPI { _ in
            JSONValue.parse(
                #"{"hits":[{"id":"m1","parent_message_id":null,"index":3,"timestamp":10,"anchor_timestamp":10,"#
                    + #""sender":"S","snippet":"say hello there","match_start":4,"match_end":9}],"#
                    + #""next_cursor":"c2","frontier_timestamp":10}"#)
        }
        let page = try await api.searchMessages(ctx, query: "hello")
        let call = try XCTUnwrap(contract.calls.first)
        XCTAssertEqual(call.method, "search_messages")
        XCTAssertEqual(call.path, .query)
        XCTAssertEqual(call.args, ["query": "hello", "cursor": .null, "limit": 20])
        XCTAssertEqual(page.nextCursor, "c2")
        let hit = try XCTUnwrap(page.hits.first)
        XCTAssertEqual(hit.highlighted.before, "say ")
        XCTAssertEqual(hit.highlighted.match, "hello")
        XCTAssertEqual(hit.highlighted.after, " there")
    }

    func testAHighlightWithOffsetsPastTheSnippetIsClamped() throws {
        let data = Data(#"{"id":"m","timestamp":1,"sender":"s","snippet":"abc","match_start":2,"match_end":99}"#.utf8)
        let hit = try JSONDecoder().decode(SearchHit.self, from: data)
        XCTAssertEqual(hit.highlighted.before, "ab")
        XCTAssertEqual(hit.highlighted.match, "c")
        XCTAssertEqual(hit.highlighted.after, "")
    }

    func testDraftsAreKeyedByChannelNameAndReadAsAQuery() async throws {
        let (api, contract) = makeAPI { call in call.method == "get_draft" ? "half a thought" : .null }
        try await api.saveDraft(ctx, channel: "general", text: "half a thought")
        let draft = try await api.getDraft(ctx, channel: "general")
        try await api.deleteDraft(ctx, channel: "general")
        XCTAssertEqual(draft, "half a thought")
        XCTAssertEqual(
            contract.calls.map { "\($0.path.rawValue) \($0.method)" },
            ["execute save_draft", "query get_draft", "execute delete_draft"])
        XCTAssertEqual(contract.calls(("save_draft")).first?.args, ["channel": "general", "text": "half a thought"])
    }

    func testUpdateInfoSendsOnlyTheFieldsThatChange() {
        XCTAssertEqual(ChatAPI.updateInfoArgs(name: "ops", description: nil), ["name": "ops"])
        XCTAssertEqual(ChatAPI.updateInfoArgs(name: nil, description: "d"), ["description": "d"])
    }

    func testRolesReadTheContractsTupleArrayAndDefaultToUser() async throws {
        let (api, contract) = makeAPI { call in
            switch call.method {
            case "list_roles": return [["A", "Admin"], ["M", "Mod"], ["B", "Banned"]]
            case "get_member_role": return "Mod"
            default: return .null
            }
        }
        let roles = try await api.listRoles(ctx)
        XCTAssertEqual(roles, ["A": .admin, "M": .mod, "B": .banned])
        let role = try await api.getMemberRole(ctx, identity: "M")
        XCTAssertEqual(role, .mod)
        try await api.setMemberRole(ctx, target: "U", role: .mod)
        XCTAssertEqual(contract.calls("set_member_role").first?.args, ["target": "U", "role": "Mod"])
        XCTAssertEqual(contract.calls("set_member_role").first?.path, .execute)
    }

    func testUnreadMentionsIsACount() async throws {
        let (api, _) = makeAPI { _ in 2 }
        let count = try await api.getUnreadMentions(ctx)
        XCTAssertEqual(count, 2)
    }
}
