import MeroKit
import XCTest

/// A channel of `count` messages as the contract pages it (`page_window` /
/// `get_messages_from`), answering a ``RecordingChatContract``.
final class ChannelModelFakeChannel: @unchecked Sendable {
    private let lock = NSLock()
    private var count: Int

    init(count: Int) { self.count = count }

    func append(_ n: Int) {
        lock.lock()
        count += n
        lock.unlock()
    }

    private var total: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }

    func answer(_ call: RecordedContractCall) throws -> JSONValue? {
        switch call.method {
        case "get_messages":
            let limit = call.args["limit"]?.intValue ?? total
            let offset = call.args["offset"]?.intValue ?? 0
            return JSONValue.parse(ChatFixtures.windowJSON(total: total, limit: limit, offset: offset))
        case "get_messages_from":
            let start = call.args["start"]?.intValue ?? 0
            let limit = call.args["limit"]?.intValue ?? total
            let end = min(total, start + limit)
            let indices = start < end ? (start..<end).map { UInt64($0) } : []
            return JSONValue.parse(ChatFixtures.pageJSON(total: total, indices: indices, offset: start))
        case "get_profiles":
            return JSONValue.parse(ChatFixtures.profilesJSON)
        case "send_message":
            append(1)
            return JSONValue.parse(ChatFixtures.sentMessageJSON)
        default:
            return JSONValue.string("ok")
        }
    }
}

@MainActor
final class ChannelModelTests: XCTestCase {
    private let entry = ChannelEntry(
        id: ChatFixtures.channelId, groupId: "g", name: "general", kind: .channel, isJoined: true, unread: 0)

    private func makeModel(count: Int) -> (ChannelModel, FakeChatBackend, ChannelModelFakeChannel) {
        let channel = ChannelModelFakeChannel(count: count)
        let contract = RecordingChatContract { try channel.answer($0) }
        let backend = FakeChatBackend(contract: contract)
        let model = ChannelModel(channel: entry, backend: backend, pageSize: 20, pollInterval: 60)
        return (model, backend, channel)
    }

    func testTheFirstPageIsTheNewestTwentyAndTheChannelIsMarkedRead() async {
        let (model, backend, _) = makeModel(count: 45)
        await model.loadInitial()

        XCTAssertEqual(model.messages.map(\.index), Array(25..<45).map { UInt64($0) })
        XCTAssertTrue(model.hasOlder)
        XCTAssertNil(model.errorText)
        let first = backend.recording.calls("get_messages").first
        XCTAssertEqual(first?.args, ["limit": 20, "offset": 0])
        XCTAssertEqual(backend.recording.calls("mark_as_read").count, 1)
        XCTAssertEqual(model.displayName(of: ChatFixtures.bob), "bob")
        XCTAssertEqual(model.myProfileName, "alice")
    }

    func testOlderPagesWalkBackToTheFirstMessageWithoutGapsOrRepeats() async {
        let (model, backend, _) = makeModel(count: 45)
        await model.loadInitial()
        await model.loadOlder()
        await model.loadOlder()

        XCTAssertEqual(model.messages.map(\.index), Array(0..<45).map { UInt64($0) })
        XCTAssertFalse(model.hasOlder)
        let offsets = backend.recording.calls("get_messages").compactMap { $0.args["offset"]?.intValue }
        XCTAssertEqual(offsets, [0, 20, 40])
    }

    func testOlderPagingStaysContiguousWhenMessagesArriveInBetween() async {
        let (model, _, channel) = makeModel(count: 45)
        await model.loadInitial()
        channel.append(7)  // seven new messages, not yet seen
        await model.loadOlder()

        // The stale total makes the window end later than the oldest loaded
        // message (12..<32 overlaps 25..<45): the overlap is deduplicated and
        // nothing is skipped.
        XCTAssertEqual(model.messages.first?.index, 12)
        let indices = model.messages.map(\.index)
        XCTAssertEqual(indices, Array(Set(indices)).sorted(), "no duplicates, in order")
        XCTAssertEqual(indices, Array(12..<45).map { UInt64($0) })
        XCTAssertTrue(model.hasOlder)
        // The next page uses the fresh total and lands exactly before index 12.
        await model.loadOlder()
        XCTAssertEqual(model.messages.map(\.index), Array(0..<45).map { UInt64($0) })
    }

    func testOlderOffsetIsTheTotalMinusTheLowestLoadedIndex() {
        XCTAssertEqual(ChannelModel.olderOffset(totalCount: 45, lowestIndex: 25), 20)
        XCTAssertEqual(ChannelModel.olderOffset(totalCount: 10, lowestIndex: 25), 0)
    }

    func testARefreshAfterABurstFillsTheGapFromTheResumableRead() async {
        let (model, backend, channel) = makeModel(count: 30)
        await model.loadInitial()  // 10..<30
        channel.append(50)  // 80 total: the newest page is 60..<80, leaving 30..<60 unread
        await model.refreshNewest()

        XCTAssertEqual(model.messages.map(\.index), Array(10..<80).map { UInt64($0) })
        let fill = backend.recording.calls("get_messages_from").first
        XCTAssertEqual(fill?.args, ["start": 30, "limit": 30])
        XCTAssertEqual(fill?.path, .query)
    }

    func testMergeKeepsTheNewerCopyAndOrdersByIndex() {
        let old = ChatMessage(index: 1, timestamp: 1, sender: "a", id: "m1", text: "before")
        let edited = ChatMessage(index: 1, timestamp: 1, sender: "a", id: "m1", text: "after", editedOn: 9)
        let other = ChatMessage(index: 0, timestamp: 0, sender: "b", id: "m0", text: "first")
        let merged = ChannelModel.merge([old], [edited, other])
        XCTAssertEqual(merged.map(\.id), ["m0", "m1"])
        XCTAssertEqual(merged.last?.text, "after")
    }

    func testSendingIsAWarrantThenTheNewestPageIsReread() async {
        let (model, backend, _) = makeModel(count: 3)
        await model.loadInitial()
        let sent = await model.send("  hello  ")

        XCTAssertTrue(sent)
        let send = backend.recording.calls("send_message").first
        XCTAssertEqual(send?.path, .execute)
        XCTAssertEqual(send?.args["message"], "hello")
        XCTAssertEqual(model.messages.count, 4)
        let empty = await model.send("   ")
        XCTAssertFalse(empty)
        XCTAssertEqual(backend.recording.calls("send_message").count, 1)
    }

    func testReactionsToggleOnTheAccountsOwnReaction() async throws {
        let (model, backend, _) = makeModel(count: 1)
        let me = ChatFixtures.myUserId
        let mine = ChatMessage(
            index: 0, timestamp: 1, sender: ChatFixtures.bob, id: "m0", text: "x", reactions: ["👍": [me]])
        let theirs = ChatMessage(
            index: 0, timestamp: 1, sender: ChatFixtures.bob, id: "m0", text: "x",
            reactions: ["👍": [ChatFixtures.bob]])

        await model.toggleReaction("👍", on: mine)
        await model.toggleReaction("👍", on: theirs)

        let calls = backend.recording.calls("update_reaction")
        XCTAssertEqual(calls.compactMap { $0.args["add"] }, [false, true])
        XCTAssertTrue(calls.allSatisfy { $0.path == .execute && $0.args["message_id"] == "m0" })
    }

    func testOnlyTheSendersOwnMessagesCanBeEditedOrDeleted() async {
        let (model, backend, _) = makeModel(count: 1)
        let mine = ChatMessage(index: 0, timestamp: 1, sender: ChatFixtures.myUserId, id: "m-mine", text: "a")
        let theirs = ChatMessage(index: 0, timestamp: 1, sender: ChatFixtures.bob, id: "m-theirs", text: "b")

        XCTAssertTrue(model.isMine(mine))
        XCTAssertFalse(model.isMine(theirs))
        await model.edit(theirs, to: "hijack")
        await model.delete(theirs)
        await model.edit(mine, to: "a, fixed")
        await model.delete(mine)

        XCTAssertEqual(backend.recording.calls("edit_message").compactMap { $0.args["message_id"] }, ["m-mine"])
        XCTAssertEqual(backend.recording.calls("delete_message").compactMap { $0.args["message_id"] }, ["m-mine"])
    }

    func testSetProfileNameIsAWarrantAndRefreshesNames() async {
        let (model, backend, _) = makeModel(count: 0)
        let ok = await model.setProfileName(" alice ")
        XCTAssertTrue(ok)
        XCTAssertEqual(backend.recording.calls("set_profile").first?.args, ["username": "alice", "avatar": .null])
        XCTAssertEqual(model.names[ChatFixtures.myUserId], "alice")
        let refused = await model.setProfileName(String(repeating: "x", count: 51))
        XCTAssertFalse(refused)
    }

    func testLiveEventsForTheChannelTriggerARefreshAndPresenceDoesNot() {
        let ctx = ChatFixtures.channelId
        XCTAssertTrue(ChannelModel.shouldRefresh(on: ChatLiveEvent(contextId: ctx, kind: "StateMutation"), contextId: ctx))
        XCTAssertTrue(ChannelModel.shouldRefresh(on: ChatLiveEvent(contextId: ctx, kind: "ExecutionEvent"), contextId: ctx))
        XCTAssertFalse(ChannelModel.shouldRefresh(on: ChatLiveEvent(contextId: ctx, kind: "Ephemeral"), contextId: ctx))
        XCTAssertFalse(ChannelModel.shouldRefresh(on: ChatLiveEvent(contextId: "other", kind: "StateMutation"), contextId: ctx))
    }

    func testAStreamedEventRereadsTheNewestPage() async throws {
        let (model, backend, channel) = makeModel(count: 5)
        await model.loadInitial()
        channel.append(1)
        backend.canSubscribe = true
        backend.liveEvents = [ChatLiveEvent(contextId: ChatFixtures.channelId, kind: "StateMutation")]

        model.startLive()
        XCTAssertEqual(model.liveStatus, .streaming)
        for _ in 0..<100 where model.messages.count < 6 {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        model.stopLive()

        XCTAssertEqual(model.messages.count, 6)
        XCTAssertEqual(model.liveStatus, .off)
    }

    func testWithNoStreamTheChannelPolls() async throws {
        let (model, backend, channel) = makeModel(count: 2)
        await model.loadInitial()
        backend.canSubscribe = false
        model.pollInterval = 0.05
        channel.append(1)

        model.startLive()
        for _ in 0..<200 where model.messages.count < 3 {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(model.liveStatus, .polling)
        model.stopLive()
        XCTAssertEqual(model.messages.count, 3)
    }

    func testAFailedReadShowsTheReason() async {
        let contract = RecordingChatContract { _ in throw ChatError.noRelay }
        let model = ChannelModel(channel: entry, backend: FakeChatBackend(contract: contract))
        await model.loadInitial()
        XCTAssertEqual(model.errorText, ChatError.noRelay.errorDescription)
        XCTAssertTrue(model.messages.isEmpty)
    }
}
