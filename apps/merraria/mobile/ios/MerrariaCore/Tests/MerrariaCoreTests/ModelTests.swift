import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import MerrariaCore

@MainActor
final class WorldsModelTests: XCTestCase {
    func testCreateFoundsANamespaceAnOpenSubgroupAndTheWorld() async throws {
        let backend = InMemoryAppBackend()
        let model = WorldsModel(backend: backend, applicationId: backend.applicationId)
        let ref = try await model.create(name: "  Caves  ", seed: 4242)
        XCTAssertEqual(ref.name, "Caves")
        XCTAssertEqual(
            backend.log,
            [
                "foundNamespace Caves",
                "createSubgroup \(ref.namespaceId) Caves open",
                "createContext \(ref.groupId!) \(backend.applicationId) Caves",
            ])
        let args = backend.initArgs[ref.contextId]
        XCTAssertEqual(args?["name"], .string("Caves"))
        XCTAssertEqual(args?["seed"], .number(4242))
        XCTAssertNotNil(args?["now"])

        await model.load()
        XCTAssertEqual(model.worlds.map(\.ref), [ref])
    }

    func testEmptyNameIsTheWebDefault() async throws {
        let backend = InMemoryAppBackend()
        let model = WorldsModel(backend: backend, applicationId: backend.applicationId)
        let ref = try await model.create(name: "   ", seed: 1)
        XCTAssertEqual(ref.name, MerrariaConstants.defaultWorldName)
    }

    func testNoRelayListsNothingAndRefusesToCreate() async {
        let backend = InMemoryAppBackend()
        backend.hasRelay = false
        let model = WorldsModel(backend: backend, applicationId: backend.applicationId)
        await model.load()
        XCTAssertTrue(model.loaded)
        XCTAssertTrue(model.worlds.isEmpty)
        do {
            _ = try await model.create(name: "x", seed: 1)
            XCTFail("created without a relay")
        } catch {
            XCTAssertEqual(error as? MerrariaError, .noRelay)
        }
    }

    func testLoadErrorIsShown() async {
        let backend = InMemoryAppBackend()
        backend.failure = URLError(.notConnectedToInternet)
        let model = WorldsModel(backend: backend, applicationId: backend.applicationId)
        await model.load()
        XCTAssertNotNil(model.error)
        model.dismissError()
        XCTAssertNil(model.error)
    }

    func testInviteLinkRoundTripsAndJoinOpensThatWorld() async throws {
        let host = InMemoryAppBackend()
        let hostModel = WorldsModel(backend: host, applicationId: host.applicationId)
        let ref = try await hostModel.create(name: "Caves", seed: 1)
        let link = try await hostModel.inviteLink(ref)
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.merraria/join?invitation="))

        let invitation = try XCTUnwrap(WorldInvitation.parse(link))
        XCTAssertEqual(invitation.namespaceId, ref.namespaceId)
        XCTAssertEqual(invitation.contextId, ref.contextId)
        XCTAssertEqual(invitation.groupId, ref.groupId)
        XCTAssertEqual(invitation.worldName, "Caves")

        let guest = InMemoryAppBackend(account: String(repeating: "cd", count: 32))
        guest.hasRelay = false
        let guestModel = WorldsModel(backend: guest, applicationId: guest.applicationId)
        var didJoin = false
        let joined = try await guestModel.join(invitation) { didJoin = true }
        XCTAssertTrue(didJoin)
        XCTAssertEqual(joined, ref)
        XCTAssertEqual(
            guest.log, ["joinNamespace \(ref.namespaceId)", "isMember \(ref.contextId)", "joinContext \(ref.contextId)"])
    }

    func testAnInvitationWithoutAWorldOpensTheNamespacesFirst() async throws {
        let backend = InMemoryAppBackend()
        let model = WorldsModel(backend: backend, applicationId: backend.applicationId)
        let ref = try await model.create(name: "Caves", seed: 1)
        let bare = WorldInvitation(
            invitation: InMemoryAppBackend.invitation(namespaceId: ref.namespaceId), worldName: nil, contextId: nil,
            groupId: nil)
        let joined = try await model.join(bare) {}
        XCTAssertEqual(joined.contextId, ref.contextId)
        XCTAssertEqual(joined.groupId, ref.groupId)
    }
}

final class WorldInvitationTests: XCTestCase {
    /// A token as the web app's `encodeInvite` writes it (camelCase signature, `groupAlias`).
    func testReadsTheWebAppsToken() throws {
        let namespaceId = String(repeating: "ab", count: 32)
        let signed = InMemoryAppBackend.invitation(namespaceId: namespaceId)
        var invitation = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(signed))
        if case .object(var fields) = invitation {
            fields["inviterSignature"] = fields["inviter_signature"]
            fields["inviter_signature"] = nil
            invitation = .object(fields)
        }
        let payload = JSONValue.object([
            "invitation": invitation, "groupAlias": "surface", "contextId": "ctx9", "groupId": "grp9",
        ])
        let json = String(decoding: try JSONEncoder().encode(payload), as: UTF8.self)
        let token = try XCTUnwrap(InviteCodec.encode(json: json))

        let parsed = try XCTUnwrap(
            WorldInvitation.parse("https://links.calimero.network/com.calimero.merraria/join?invitation=\(token)"))
        XCTAssertEqual(parsed.namespaceId, namespaceId)
        XCTAssertEqual(parsed.worldName, "surface")
        XCTAssertEqual(parsed.contextId, "ctx9")
        XCTAssertEqual(parsed.groupId, "grp9")
        XCTAssertNotNil(WorldInvitation.parse(token))
    }

    func testRefusesAnotherAppsLinkAndJunk() throws {
        let signed = InMemoryAppBackend.invitation(namespaceId: String(repeating: "ab", count: 32))
        let token = try WorldInvitation(invitation: signed, worldName: nil, contextId: nil, groupId: nil).token()
        XCTAssertNil(WorldInvitation.parse("https://links.calimero.network/com.calimero.chat/join?invitation=\(token)"))
        XCTAssertNil(WorldInvitation.parse("hello"))
    }
}

@MainActor
final class GameModelTests: XCTestCase {
    private func model(
        _ backend: InMemoryAppBackend = InMemoryAppBackend()
    ) -> (GameModel, InMemoryAppBackend, Box) {
        let ref = WorldRef(contextId: "ctx1", namespaceId: "ns1", groupId: "g1", name: "Caves")
        let game = GameModel(backend: backend, ref: ref, settings: MemoryPlayerSettings(name: "Ada", zoom: 1.2))
        let box = Box()
        game.send = { box.sent.append($0) }
        return (game, backend, box)
    }

    final class Box { var sent: [AppMessage] = [] }

    func testAnswersTheConfigRequest() {
        let (game, _, box) = model()
        game.receive(#"{"type":"request","id":1,"op":"config"}"#)
        XCTAssertEqual(
            box.sent, [.response(id: 1, result: .success(#"{"contextId":"ctx1","name":"Ada","zoom":1.2}"#))])
    }

    func testRunsContractRequestsAndAnswersFailures() async throws {
        let backend = InMemoryAppBackend()
        backend.recording.setHandler { call in
            if call.method == "world_meta" { throw MeroError.network("offline") }
            return .array([])
        }
        let (game, _, box) = model(backend)
        game.receive(#"{"type":"request","id":2,"op":"query","method":"get_overrides","args":{}}"#)
        game.receive(#"{"type":"request","id":3,"op":"query","method":"world_meta","args":{}}"#)
        try await waitUntil { box.sent.count == 2 }
        XCTAssertTrue(box.sent.contains(.response(id: 2, result: .success("[]"))))
        XCTAssertTrue(box.sent.contains(.response(id: 3, result: .failure(BridgeFailure("Network error: offline")))))
    }

    func testHudAndStatusDriveTheScreen() {
        let (game, _, _) = model()
        XCTAssertEqual(game.phase, .loading)
        game.receive(##"{"type":"hud","sel":1,"slots":[{"id":1,"name":"dirt","color":"#8a5a33","count":2},{"id":3,"name":"stone","color":"#7e8288","count":0}]}"##)
        XCTAssertEqual(game.phase, .playing)
        XCTAssertEqual(game.selected, 1)
        XCTAssertEqual(game.slots.count, 2)
        XCTAssertFalse(game.connected)
        game.receive(#"{"type":"status","state":"connected"}"#)
        XCTAssertTrue(game.connected)
        game.receive(#"{"type":"fatal","message":"Could not reach the shared world"}"#)
        XCTAssertEqual(game.phase, .failed("Could not reach the shared world"))
    }

    func testControlsSendInputAndPauseLiftsThem() {
        let (game, _, box) = model()
        game.receive(##"{"type":"hud","sel":0,"slots":[{"id":1,"name":"dirt","color":"#8a5a33","count":2},{"id":3,"name":"stone","color":"#7e8288","count":0}]}"##)
        game.press(.right)
        game.press(.jump)
        game.release(.jump)
        game.tap(x: 90, y: 30)
        game.select(1)
        game.pause()
        game.press(.left)  // ignored while paused
        XCTAssertEqual(
            box.sent,
            [
                .input(GameInput(move: 1)),
                .input(GameInput(move: 1, jump: true, jumpPressed: true)),
                .input(GameInput(move: 1)),
                .target(x: 90, y: 30),
                .select(slot: 1),
                .input(.idle),
                .pause,
            ])
        XCTAssertEqual(game.selected, 1)
        XCTAssertTrue(game.paused)
        game.resume()
        XCTAssertFalse(game.paused)
    }

    func testZoomIsClampedSavedAndSent() {
        let settings = MemoryPlayerSettings()
        let game = GameModel(
            backend: InMemoryAppBackend(), ref: WorldRef(contextId: "c", namespaceId: "n", groupId: nil, name: "w"),
            settings: settings)
        var sent: [AppMessage] = []
        game.send = { sent.append($0) }
        game.setZoom(3)
        XCTAssertEqual(settings.zoom, 1.6)
        XCTAssertEqual(sent, [.zoom(1.6)])
    }

    func testLeaveWaitsForThePageToSave() async {
        let (game, _, box) = model()
        let leaving = Task { await game.leave() }
        try? await waitUntil { box.sent.contains(.leave) }
        game.receive(#"{"type":"left"}"#)
        await leaving.value
        XCTAssertEqual(game.phase, .left)
    }

    func testLeaveGivesUpOnASilentPage() async {
        let (game, _, _) = model()
        await game.leave(timeout: .milliseconds(50))
        XCTAssertEqual(game.phase, .left)
    }

    func testStartJoinsTheWorldAndForwardsRelayEvents() async throws {
        let backend = InMemoryAppBackend()
        backend.canSubscribe = true
        let (game, _, box) = model(backend)
        await game.start()
        XCTAssertEqual(backend.log, ["isMember ctx1", "joinContext ctx1"])
        try await Task.sleep(for: .milliseconds(50))
        backend.emit(AppContextEvent(contextId: "ctx1", kind: "StateMutation"))
        try await waitUntil { !box.sent.isEmpty }
        XCTAssertEqual(box.sent, [.event(kind: "StateMutation")])
        game.stop()
    }

    private func waitUntil(_ condition: @escaping @MainActor () -> Bool) async throws {
        for _ in 0..<200 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("timed out")
    }
}
