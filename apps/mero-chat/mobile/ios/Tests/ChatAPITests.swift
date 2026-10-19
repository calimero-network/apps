import MeroKit
import XCTest

/// Every contract method the app calls: its name, its arguments (the web
/// app's names and shapes), whether it reads (query) or writes (warrant), and
/// how its result is read.
final class ChatAPITests: XCTestCase {
    private let ctx = ChatFixtures.channelId
    private let fixedNow = Date(timeIntervalSince1970: 1_760_000_123.75)

    private func makeAPI(_ handler: @escaping RecordingChatContract.Handler) -> (ChatAPI, RecordingChatContract) {
        let contract = RecordingChatContract(handler: handler)
        let now = fixedNow
        return (ChatAPI(contract: contract, now: { now }), contract)
    }

    // MARK: Reads go through the query path

    func testGetMessagesSendsTheWebAppsPagingArgsAsAQuery() async throws {
        let (api, contract) = makeAPI { _ in
            JSONValue.parse(ChatFixtures.windowJSON(total: 45, limit: 20, offset: 0))
        }
        let page = try await api.getMessages(ctx, limit: 20, offset: 0)

        let call = try XCTUnwrap(contract.calls.first)
        XCTAssertEqual(call.path, .query)
        XCTAssertEqual(call.contextId, ctx)
        XCTAssertEqual(call.method, "get_messages")
        // `parent_message` and `search_term` are left out, as JSON.stringify drops `undefined`.
        XCTAssertEqual(call.args, ["limit": 20, "offset": 0])
        XCTAssertEqual(CanonicalJSON.string(call.args), #"{"limit":20,"offset":0}"#)

        XCTAssertEqual(page.totalCount, 45)
        XCTAssertEqual(page.startPosition, 0)
        XCTAssertEqual(page.messages.map(\.index), Array(25..<45).map { UInt64($0) })
    }

    func testGetMessagesNamesTheParentOnlyForAThread() {
        XCTAssertEqual(
            ChatAPI.getMessagesArgs(limit: 20, offset: 40, parentMessage: "p_1"),
            ["limit": 20, "offset": 40, "parent_message": "p_1"])
    }

    func testGetMessagesFromIsTheResumableReadByIndex() async throws {
        let (api, contract) = makeAPI { _ in JSONValue.parse(ChatFixtures.pageJSON(total: 45, indices: [30, 31], offset: 30)) }
        let page = try await api.getMessagesFrom(ctx, start: 30, limit: 2)
        let call = try XCTUnwrap(contract.calls.first)
        XCTAssertEqual(call.path, .query)
        XCTAssertEqual(call.method, "get_messages_from")
        XCTAssertEqual(call.args, ["start": 30, "limit": 2])
        XCTAssertEqual(page.messages.map(\.index), [30, 31])
    }

    func testGetInfoAndProfilesAndUnreadAreQueriesWithNoArgs() async throws {
        let (api, contract) = makeAPI { call in
            switch call.method {
            case "get_info": return JSONValue.parse(ChatFixtures.channelInfoJSON)
            case "get_profiles": return JSONValue.parse(ChatFixtures.profilesJSON)
            case "get_unread_count": return 3
            default: return .null
            }
        }
        let info = try await api.getInfo(ctx)
        let profiles = try await api.getProfiles(ctx)
        let unread = try await api.getUnreadCount(ctx)

        XCTAssertEqual(info, ChannelInfo(
            name: "general", kind: .channel, createdAt: 1_760_000_000, creator: ChatFixtures.bob))
        XCTAssertEqual(profiles.map(\.username), ["alice", "bob"])
        XCTAssertEqual(profiles.first?.identity, ChatFixtures.myUserId)
        XCTAssertEqual(unread, 3)
        XCTAssertEqual(contract.calls.map(\.method), ["get_info", "get_profiles", "get_unread_count"])
        XCTAssertTrue(contract.calls.allSatisfy { $0.path == .query && $0.args == [:] })
    }

    // MARK: Writes go through the warrant (intents) path

    func testSendMessageIsAWarrantWithSecondsTimestampAndEmptyMentions() async throws {
        let (api, contract) = makeAPI { _ in JSONValue.parse(ChatFixtures.sentMessageJSON) }
        let sent = try await api.sendMessage(ctx, text: "hello")

        let call = try XCTUnwrap(contract.calls.first)
        XCTAssertEqual(call.path, .execute)
        XCTAssertEqual(call.method, "send_message")
        let expected: JSONValue = [
            "message": "hello", "mentions": [], "mentions_usernames": [], "timestamp": 1_760_000_123,
        ]
        XCTAssertEqual(call.args, expected)
        XCTAssertEqual(sent.text, "hello")
        XCTAssertTrue(sent.id.hasSuffix("_1760000100"))
    }

    func testEditDeleteReactProfileAndReadAreWarrantsWithTheContractsArgNames() async throws {
        let (api, contract) = makeAPI { call in
            call.method == "edit_message" ? JSONValue.parse(ChatFixtures.sentMessageJSON) : JSONValue.string("ok")
        }
        try await api.editMessage(ctx, messageId: "m_1", text: "fixed")
        try await api.deleteMessage(ctx, messageId: "m_1")
        try await api.updateReaction(ctx, messageId: "m_1", emoji: "👍", add: true)
        try await api.updateReaction(ctx, messageId: "m_1", emoji: "👍", add: false)
        try await api.setProfile(ctx, username: "alice")
        try await api.markAsRead(ctx)

        let calls = contract.calls
        XCTAssertTrue(calls.allSatisfy { $0.path == .execute }, "every write is a warrant")
        XCTAssertEqual(
            calls.map(\.method),
            ["edit_message", "delete_message", "update_reaction", "update_reaction", "set_profile", "mark_as_read"])
        let ts: JSONValue = 1_760_000_123
        XCTAssertEqual(calls[0].args, ["message_id": "m_1", "new_message": "fixed", "timestamp": ts])
        XCTAssertEqual(calls[1].args, ["message_id": "m_1"])
        XCTAssertEqual(calls[2].args, ["message_id": "m_1", "emoji": "👍", "add": true])
        XCTAssertEqual(calls[3].args, ["message_id": "m_1", "emoji": "👍", "add": false])
        XCTAssertEqual(calls[4].args, ["username": "alice", "avatar": .null])
        XCTAssertEqual(calls[5].args, ["timestamp": ts])
    }

    func testChannelInitArgsMatchTheWebAppsCreateChannel() {
        let args = ChatAPI.channelInitArgs(name: "random", createdAt: 1_760_000_000)
        XCTAssertEqual(
            CanonicalJSON.string(args),
            #"{"context_type":"Channel","created_at":1760000000,"creator_username":"","description":"","name":"random"}"#)
        XCTAssertEqual(ChatJSON.bytes(args), Array(CanonicalJSON.string(args).utf8).map { Int($0) })
    }

    // MARK: Results

    func testAMalformedResultSaysWhichMethodItWas() async {
        let (api, _) = makeAPI { _ in .string("nope") }
        do {
            _ = try await api.getMessages(ctx, limit: 20, offset: 0)
            XCTFail("expected a decoding failure")
        } catch let error as ChatError {
            guard case .badResponse(let method, _) = error else { return XCTFail("\(error)") }
            XCTAssertEqual(method, "get_messages")
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testANegativeOrMissingUnreadCountIsRefused() async {
        let (api, _) = makeAPI { _ in .null }
        do {
            _ = try await api.getUnreadCount(ctx)
            XCTFail("expected a failure")
        } catch {
            XCTAssertTrue(error is ChatError)
        }
    }
}
