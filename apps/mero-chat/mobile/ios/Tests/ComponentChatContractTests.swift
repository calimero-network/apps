import MeroKit
import XCTest

/// The component ABI's wire (`logic/res/abi.json`), as the web's `meroChat.ts` converts it.
final class ComponentChatContractTests: XCTestCase {
    func testMethodsAndArgumentsGoToCamelCaseWithU64sAsStrings() {
        XCTAssertEqual(ComponentChatContract.method("get_messages_from"), "getMessagesFrom")
        XCTAssertEqual(ComponentChatContract.method("init"), "init")
        let attachment = ChatAttachment(name: "a.png", mimeType: "image/png", size: 10, blobId: String(repeating: "0f", count: 32))
        let args = ComponentChatContract.args(
            ChatAPI.sendMessageArgs(
                text: "hi", timestamp: 1_760_000_000, mentions: ["acc"], mentionsUsernames: ["ana"], images: [attachment]))
        XCTAssertEqual(args["message"], "hi")
        XCTAssertEqual(args["timestamp"], "1760000000")
        XCTAssertEqual(args["mentionsUsernames"], ["ana"])
        XCTAssertEqual(args["images"]?.arrayValue?.first?["mimeType"], "image/png")
        XCTAssertEqual(args["images"]?.arrayValue?.first?["blobIdStr"], .string(String(repeating: "0f", count: 32)))
        XCTAssertEqual(args["images"]?.arrayValue?.first?["size"], 10)
        XCTAssertEqual(
            ComponentChatContract.args(ChatAPI.getMessagesFromArgs(start: 40, limit: 20)), ["start": "40", "limit": 20])
        XCTAssertEqual(
            ComponentChatContract.args(ChatAPI.editMessageArgs(messageId: "m", text: "t", timestamp: 5, parentId: "p")),
            ["messageId": "m", "newMessage": "t", "timestamp": "5", "parentId": "p"])
    }

    func testAnswersComeBackInV1Shapes() throws {
        let answer = JSONValue.parse(
            """
            {"totalCount":1,"startPosition":0,"messages":[{"index":"7","timestamp":"1760000000","sender":"acc",
             "mentions":[],"mentionsUsernames":["ana"],"files":[],"images":[{"name":"a.png","mimeType":"image/png",
             "size":"10","blobId":"b","uploadedAt":"1760000001"}],"id":"m_1","text":"hi","editedOn":null,
             "reactions":{"👍":["acc"]},"deleted":null,"threadCount":2,"threadLastTimestamp":"1760000002",
             "parentMessageId":null}]}
            """)
        let v1 = try XCTUnwrap(ComponentChatContract.result(answer, method: "get_messages"))
        XCTAssertEqual(v1["total_count"], 1)
        let message = try XCTUnwrap(v1["messages"]?.arrayValue?.first)
        XCTAssertEqual(message["index"], 7)
        XCTAssertEqual(message["timestamp"], 1_760_000_000)
        XCTAssertEqual(message["thread_last_timestamp"], 1_760_000_002)
        XCTAssertEqual(message["mentions_usernames"], ["ana"])
        XCTAssertEqual(message["images"]?.arrayValue?.first?["uploaded_at"], 1_760_000_001)
        XCTAssertEqual(message["images"]?.arrayValue?.first?["mime_type"], "image/png")
        XCTAssertEqual(message["reactions"]?["👍"], ["acc"])
        let page = try ChatJSON.decode(MessagePage.self, v1, method: "get_messages")
        XCTAssertEqual(page.messages.first?.id, "m_1")
        XCTAssertEqual(ComponentChatContract.result("12", method: "get_message_count"), 12)
    }
}
