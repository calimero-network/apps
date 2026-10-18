import MeroKit
import XCTest

/// Reading the contract's result shapes.
final class ChatModelsTests: XCTestCase {
    func testAMessageWithReactionsDecodesFieldForField() throws {
        let json = ChatFixtures.messageJSON(
            index: 7, sender: ChatFixtures.bob, text: "hi there",
            reactions: #"{"👍":["\#(ChatFixtures.myUserId)","\#(ChatFixtures.bob)"]}"#, editedOn: "1760000999")
        let message = try ChatJSON.decode(ChatMessage.self, JSONValue.parse(json), method: "get_messages")

        XCTAssertEqual(message.index, 7)
        XCTAssertEqual(message.timestamp, 1_760_000_007)
        XCTAssertEqual(message.sender, ChatFixtures.bob)
        XCTAssertEqual(message.text, "hi there")
        XCTAssertEqual(message.editedOn, 1_760_000_999)
        XCTAssertFalse(message.deleted)
        XCTAssertEqual(message.reactions["👍"]?.count, 2)
        XCTAssertTrue(message.hasReaction("👍", by: ChatFixtures.myUserId))
        XCTAssertFalse(message.hasReaction("🎉", by: ChatFixtures.myUserId))
        XCTAssertNil(message.parentMessageId)
    }

    func testADeletedMessageKeepsItsSlotWithBlankText() throws {
        let json = ChatFixtures.messageJSON(index: 3, sender: ChatFixtures.bob, text: "", deleted: "true")
        let message = try ChatJSON.decode(ChatMessage.self, JSONValue.parse(json), method: "get_messages")
        XCTAssertTrue(message.deleted)
        XCTAssertEqual(message.index, 3)
        XCTAssertEqual(message.reactions, [:])
    }

    func testIntegersThatArriveAsDoublesStillDecode() throws {
        // A relay hands `returns` back as generic JSON: a u64 may be a double.
        let value: JSONValue = [
            "total_count": .number(3.0), "start_position": .number(0),
            "messages": [
                [
                    "index": .number(2.0), "timestamp": .number(1_760_000_000.0), "sender": "x", "id": "m_1",
                    "text": "t",
                ],
            ],
        ]
        let page = try ChatJSON.decode(MessagePage.self, value, method: "get_messages")
        XCTAssertEqual(page.totalCount, 3)
        XCTAssertEqual(page.messages.first?.index, 2)
        XCTAssertEqual(page.messages.first?.timestamp, 1_760_000_000)
    }

    func testADmTitleIsTheOtherPersonsName() {
        let me = ChatFixtures.myUserId
        let created = ChannelInfo(name: "DM: bob", kind: .dm, description: #"{"c":"alice","o":"bob"}"#, creator: me)
        let received = ChannelInfo(
            name: "DM: bob", kind: .dm, description: #"{"c":"alice","o":"bob"}"#, creator: ChatFixtures.bob)
        XCTAssertEqual(created.dmTitle(viewer: me), "bob")
        XCTAssertEqual(received.dmTitle(viewer: me), "alice")
        XCTAssertNil(ChannelInfo(name: "general", kind: .channel).dmTitle(viewer: me))
    }

    func testTheDmContextTypeDecodes() throws {
        let value = JSONValue.parse(
            #"{"name":"DM: bob","context_type":"Dm","description":"","created_at":1,"creator":"x"}"#)
        XCTAssertEqual(try ChatJSON.decode(ChannelInfo.self, value, method: "get_info").kind, .dm)
    }

    func testAnAccountsUserIdIsBase58OfItsBytes() throws {
        let userId = try XCTUnwrap(ChatIdentity.userId(accountHex: ChatFixtures.account))
        let bytes = try XCTUnwrap(InviteCodec.base58Decode(userId))
        XCTAssertEqual(Hex.encode(bytes), ChatFixtures.account)
        XCTAssertNil(ChatIdentity.userId(accountHex: "not-hex"))
    }

    func testTimestampsAreWholeSeconds() {
        XCTAssertEqual(chatTimestamp(Date(timeIntervalSince1970: 1_760_000_000.999)), 1_760_000_000)
    }
}
