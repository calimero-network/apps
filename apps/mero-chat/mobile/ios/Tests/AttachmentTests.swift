import MeroKit
import XCTest

/// Attachments and avatars: uploaded as blobs against the channel, sent the
/// way the web app sends them, read back through the channel.
@MainActor
final class AttachmentTests: XCTestCase {
    private let entry = ChannelEntry(
        id: ChatFixtures.channelId, groupId: "g", name: "general", kind: .channel, isJoined: true, unread: 0)

    private func makeModel() -> (ChannelModel, FakeChatBackend) {
        let contract = RecordingChatContract { call in
            switch call.method {
            case "get_messages": return JSONValue.parse(ChatFixtures.pageJSON(total: 0, indices: [], offset: 0))
            case "get_profiles": return JSONValue.parse(ChatFixtures.profilesJSON)
            case "send_message": return JSONValue.parse(ChatFixtures.sentMessageJSON)
            default: return .null
            }
        }
        let backend = FakeChatBackend(contract: contract)
        return (ChannelModel(channel: entry, backend: backend, pollInterval: 60), backend)
    }

    func testAnImageAndAFileAreUploadedToTheChannelThenSentAsTheWebAppSendsThem() async throws {
        let (model, backend) = makeModel()
        await model.loadInitial()
        let image = PendingAttachment(name: "photo.jpg", mimeType: "image/jpeg", data: Data(repeating: 1, count: 10))
        let file = PendingAttachment(name: "notes.pdf", mimeType: "application/pdf", data: Data(repeating: 2, count: 4))

        let sent = await model.send("look", attachments: [image, file])

        XCTAssertTrue(sent)
        XCTAssertEqual(backend.blobs.count, 2)
        XCTAssertTrue(backend.blobs.values.allSatisfy { $0.contextId == ChatFixtures.channelId })
        let args = try XCTUnwrap(backend.recording.calls("send_message").first?.args)
        let imageId = try XCTUnwrap(backend.blobs.first { $0.value.data.count == 10 }?.key)
        let fileId = try XCTUnwrap(backend.blobs.first { $0.value.data.count == 4 }?.key)
        XCTAssertEqual(
            args["images"],
            [["name": "photo.jpg", "mime_type": "image/jpeg", "size": 10, "blob_id_str": .string(imageId)]])
        XCTAssertEqual(
            args["files"],
            [["name": "notes.pdf", "mime_type": "application/pdf", "size": 4, "blob_id_str": .string(fileId)]])
        XCTAssertEqual(args["message"], "<p>look</p>")
        XCTAssertNil(model.uploadStatus)
    }

    func testAnAttachmentAloneSendsAnEmptyBody() async {
        let (model, backend) = makeModel()
        await model.loadInitial()
        let file = PendingAttachment(name: "a.txt", mimeType: "text/plain", data: Data([1]))
        let sent = await model.send("   ", attachments: [file])
        XCTAssertTrue(sent)
        XCTAssertEqual(backend.recording.calls("send_message").first?.args["message"], "")
    }

    func testAMessageWithoutAttachmentsLeavesThemOut() {
        let args = ChatAPI.sendMessageArgs(text: "x", timestamp: 1)
        XCTAssertNil(args["files"])
        XCTAssertNil(args["images"])
    }

    func testAFailedUploadSendsNothingAndSaysWhy() async {
        let (model, backend) = makeModel()
        await model.loadInitial()
        backend.blobFailure = CalimeroError(status: 403, code: "FORBIDDEN", message: "not a member")
        let file = PendingAttachment(name: "a.txt", mimeType: "text/plain", data: Data([1]))

        let sent = await model.send("hi", attachments: [file])

        XCTAssertFalse(sent)
        XCTAssertTrue(backend.recording.calls("send_message").isEmpty)
        XCTAssertEqual(model.errorText, "not a member (403)")
    }

    func testABlobIsReadThroughTheChannelOnceThenFromTheCache() async throws {
        let (model, backend) = makeModel()
        let id = try await backend.uploadBlob(contextId: ChatFixtures.channelId, data: Data("img".utf8))

        let first = try await model.blob(id)
        let second = try await model.blob(id)

        XCTAssertEqual(first, Data("img".utf8))
        XCTAssertEqual(second, first)
        XCTAssertEqual(backend.log.filter { $0.hasPrefix("downloadBlob") }, ["downloadBlob \(id) \(ChatFixtures.channelId)"])
    }

    func testAnAvatarIsUploadedThenSetWithTheNameTheChannelAlreadyHas() async throws {
        let (model, backend) = makeModel()
        await model.loadInitial()
        let picture = PendingAttachment(name: "me.jpg", mimeType: "image/jpeg", data: Data([7, 7]))

        let ok = await model.setAvatar(picture)

        XCTAssertTrue(ok)
        let blobId = try XCTUnwrap(backend.blobs.keys.first)
        XCTAssertEqual(
            backend.recording.calls("set_profile").last?.args, ["username": "alice", "avatar": .string(blobId)])
    }

    func testProfilesCarryTheirAvatars() async {
        let contract = RecordingChatContract { call in
            call.method == "get_profiles"
                ? JSONValue.parse(#"[{"identity":"U1","username":"ana","avatar":"blob-1"},{"identity":"U2","username":"bo","avatar":null}]"#)
                : .null
        }
        let model = ChannelModel(channel: entry, backend: FakeChatBackend(contract: contract), pollInterval: 60)
        await model.loadProfiles()
        XCTAssertEqual(model.avatars, ["U1": "blob-1"])
    }
}
