import MeroKit
import XCTest

/// Threads, mentions, moderation and drafts on top of ``ChannelModel``.
@MainActor
final class ChannelFeaturesTests: XCTestCase {
    private let entry = ChannelEntry(
        id: ChatFixtures.channelId, groupId: "g", name: "general", kind: .channel, isJoined: true, unread: 0)

    private func makeModel(
        thread: ChatMessage? = nil, role: String = "User", draft: String = "",
        sender: String = ChatFixtures.bob
    ) -> (ChannelModel, RecordingChatContract) {
        let contract = RecordingChatContract { call in
            switch call.method {
            case "get_messages":
                return JSONValue.parse(ChatFixtures.pageJSON(total: 2, indices: [0, 1], offset: 0, sender: sender))
            case "get_profiles": return JSONValue.parse(ChatFixtures.profilesJSON)
            case "get_member_role": return .string(role)
            case "get_draft": return .string(draft)
            case "send_message": return JSONValue.parse(ChatFixtures.sentMessageJSON)
            default: return .null
            }
        }
        let model = ChannelModel(
            channel: entry, backend: FakeChatBackend(contract: contract), thread: thread, pageSize: 20,
            pollInterval: 60)
        model.draftDelay = 0
        return (model, contract)
    }

    private func root() throws -> ChatMessage {
        try JSONDecoder().decode(
            ChatMessage.self, from: Data(ChatFixtures.messageJSON(index: 7, sender: ChatFixtures.bob, text: "root").utf8))
    }

    // MARK: Threads

    func testAThreadReadsAndWritesUnderItsRootAndNeverMarksTheChannelRead() async throws {
        let root = try root()
        let (model, contract) = makeModel(thread: root)
        await model.loadInitial()
        XCTAssertEqual(contract.calls("get_messages").first?.args["parent_message"], .string(root.id))
        XCTAssertTrue(contract.calls("mark_as_read").isEmpty)
        XCTAssertTrue(contract.calls("get_draft").isEmpty, "drafts belong to the channel's composer")

        await model.send("a reply")
        XCTAssertEqual(contract.calls("send_message").first?.args["parent_message"], .string(root.id))

        let mine = try JSONDecoder().decode(
            ChatMessage.self,
            from: Data(ChatFixtures.messageJSON(index: 0, sender: ChatFixtures.myUserId, text: "x").utf8))
        await model.edit(mine, to: "y")
        await model.delete(mine)
        XCTAssertEqual(contract.calls("edit_message").first?.args["parent_id"], .string(root.id))
        XCTAssertEqual(contract.calls("delete_message").first?.args["parent_id"], .string(root.id))
        XCTAssertTrue(contract.calls("get_messages_from").isEmpty, "the top-level resumable read is not a thread's")
    }

    func testTheChannelItselfNamesNoParent() async {
        let (model, contract) = makeModel()
        await model.loadInitial()
        await model.send("top level")
        XCTAssertNil(contract.calls("get_messages").first?.args["parent_message"])
        XCTAssertNil(contract.calls("send_message").first?.args["parent_message"])
    }

    // MARK: Mentions

    func testMentionsNameMembersByDisplayNameAndBroadcastsByName() {
        let names = ["ID_BOB": "bob", "ID_ANA": "Ana"]
        let found = ChannelModel.mentions(in: "hey @ana and @bob, also @here @nobody @bob", names: names)
        XCTAssertEqual(found.ids, ["ID_ANA", "ID_BOB"])
        XCTAssertEqual(found.usernames, ["Ana", "bob", "here"])
    }

    func testASentMessageCarriesItsMentions() async {
        let (model, contract) = makeModel()
        await model.loadInitial()
        await model.send("ping @bob")
        let args = contract.calls("send_message").first?.args
        XCTAssertEqual(args?["mentions"], [.string(ChatFixtures.bob)])
        XCTAssertEqual(args?["mentions_usernames"], ["bob"])
    }

    // MARK: Moderation

    func testOnlyYourOwnMessagesAreEditableButStaffMayDeleteAnyone() async throws {
        let bobs = try root()
        let (user, _) = makeModel(role: "User")
        await user.loadInitial()
        XCTAssertFalse(user.canDelete(bobs))
        XCTAssertFalse(user.canEdit(bobs))

        let (mod, contract) = makeModel(role: "Mod")
        await mod.loadInitial()
        XCTAssertEqual(mod.myRole, .mod)
        XCTAssertTrue(mod.canDelete(bobs))
        XCTAssertFalse(mod.canEdit(bobs))
        await mod.delete(bobs)
        XCTAssertEqual(contract.calls("delete_message").first?.args, ["message_id": .string(bobs.id)])
    }

    // MARK: Drafts

    func testTheSavedDraftLoadsAndIsSavedAndClearedLikeTheWebApp() async throws {
        let (model, contract) = makeModel(draft: "unfinished")
        await model.loadInitial()
        XCTAssertEqual(model.savedDraft, "unfinished")
        XCTAssertEqual(contract.calls("get_draft").first?.args, ["channel": "general"])

        model.draftChanged("still typing")
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(contract.calls("save_draft").last?.args, ["channel": "general", "text": "still typing"])

        model.draftChanged("   ")
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(contract.calls("delete_draft").count, 1, "an emptied composer drops the draft")

        await model.send("sent")
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(contract.calls("delete_draft").count, 2, "sending drops it too")
        XCTAssertEqual(model.savedDraft, "")
    }
}
