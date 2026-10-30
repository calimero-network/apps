import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import BlocksCore

enum Fixtures {
    static let me = String(repeating: "ab", count: 32)
    static let device = String(repeating: "de", count: 32)

    /// A 0.x token minted by the web app's own `encodeInvite` (app/src/net/inviteCodec.ts) around
    /// a signed group invitation. Calimero 1.0 refuses it.
    static let legacyWebToken =
        "7AFNTiMbuC1rQX6sQZrCxrz8XFBVKtQDKdMiR8LFqwvyQgcAA4XhtpgMvEfNRGNdS7wfvMbvXHUkin1Muc2rvHvWw5doEVRkA8kqvekckd8i44TAFRo2"
        + "nqu393v5Nvqibt9sAPcedipQwZ2U8xTfFZ5R3hnbRikgPQ7edPWzNAiw3fsy7ngpq1SM4JzhEctVt25vA6JtmiA85u34vQBgJd9Dkuie2K2MwAwSQx"
        + "NgiogEagrqbWuetiedN5u8iCdUfcsicugJi1irX9ZRoD7ZnDHyCCUMPsfjV6e5HhUEMik45vMjZ2B5iCrmVj1HvNUboqgDh6UL5VNZ3cmbFkHC9bGMgi"
    static let webNamespace = (1...32).map { String(format: "%02x", $0) }.joined()

    /// A 1.0 link token: the org invite for `webNamespace`, the world's app instance ("c"×64) and
    /// team ("b"×64), named "Lime Valley".
    static let webToken = try! InviteCodec.encode(
        [
            "invitation": "inv_lime", "namespaceId": .string(webNamespace), "contextId": .string(String(repeating: "c", count: 64)),
            "name": "Lime Valley", "groupId": .string(String(repeating: "b", count: 64)),
        ] as JSONValue)

    static func meta() -> JSONValue { .object(["name": "Lime Valley", "seed": 1337, "createdAt": 1_730_000_000]) }
}

final class InvitationTests: XCTestCase {
    func testReadsTheWebAppsLink() throws {
        let link = InviteLink.invitation(token: Fixtures.webToken, slug: BlocksConstants.packageName)
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-blocks/join?invitation="), link)
        let invitation = try XCTUnwrap(BlocksInvitation.parse(link))
        XCTAssertEqual(invitation.name, "Lime Valley")
        XCTAssertEqual(invitation.contextId, String(repeating: "c", count: 64))
        XCTAssertEqual(invitation.groupId, String(repeating: "b", count: 64))
        XCTAssertEqual(invitation.namespaceId, Fixtures.webNamespace)
        XCTAssertNotNil(BlocksInvitation.parse(Fixtures.webToken), "a bare token")
        XCTAssertNotNil(BlocksInvitation.parse("calimero://com.calimero.mero-blocks/join?invitation=\(Fixtures.webToken)"))
    }

    func testRefusesAnotherAppsLinkAndJunk() {
        XCTAssertNil(BlocksInvitation.parse(InviteLink.invitation(token: Fixtures.webToken, slug: "com.calimero.chat")))
        XCTAssertNil(BlocksInvitation.parse(Fixtures.legacyWebToken), "a pre-1.0 signed invitation")
        XCTAssertNil(BlocksInvitation.parse("hello"))
        XCTAssertNil(BlocksInvitation.parse(""))
    }

    /// What the phone mints is an ``OrgInvitation`` any 1.0 client reads, plus the world's team.
    func testMintsTheOrgInvitationPayload() throws {
        let original = try XCTUnwrap(BlocksInvitation.parse(Fixtures.webToken))
        let minted = BlocksInvitation(
            invitation: original.invitation, name: "Ana's world", contextId: "ctx-1", groupId: "grp-1")
        let json = try XCTUnwrap(InviteCodec.decode(token: try minted.token()))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        XCTAssertEqual(object["invitation"] as? String, "inv_lime")
        XCTAssertEqual(object["namespaceId"] as? String, Fixtures.webNamespace)
        XCTAssertEqual(object["name"] as? String, "Ana's world")
        XCTAssertEqual(object["contextId"] as? String, "ctx-1")
        XCTAssertEqual(object["groupId"] as? String, "grp-1")
        XCTAssertEqual(OrgInvitation.decode(try minted.token())?.contextId, "ctx-1")

        let back = try XCTUnwrap(BlocksInvitation.parse(try minted.link()))
        XCTAssertEqual(back.name, "Ana's world")
        XCTAssertEqual(back.contextId, "ctx-1")
        XCTAssertEqual(back.namespaceId, Fixtures.webNamespace)
    }

    func testTheNodesErrorsReadAsWords() {
        XCTAssertEqual(
            BlocksText.error(ReleaseDeadlineError("deadline", details: ["release": "2.3.110"])),
            "Your cluster takes no new work until node release 2.3.110 is approved. Review it under Needs your approval.")
        XCTAssertEqual(BlocksText.error(NotFound("no such app")), "This isn't shared with you, or it was deleted.")
        XCTAssertEqual(BlocksText.error(LoginRequired("expired")), "Your session ended. Sign in again.")
    }

}

@MainActor
final class WorldsModelTests: XCTestCase {
    private var backend: InMemoryAppBackend!

    override func setUp() async throws {
        backend = InMemoryAppBackend(account: Fixtures.me)
    }

    func testCreatesAWorldTheWayTheWebAppDoes() async throws {
        let model = WorldsModel(backend: backend, applicationId: backend.applicationId)
        let ref = try await model.create(name: "  Lime Valley  ", seed: 4242)
        XCTAssertEqual(ref.name, "Lime Valley")
        let log = backend.log
        XCTAssertEqual(log.first, "foundNamespace Lime Valley")
        XCTAssertTrue(log.contains("createSubgroup \(ref.namespaceId) Lime Valley open"), "\(log)")
        XCTAssertEqual(ref.groupId.map { backend.publicSubgroups.contains($0) }, true)
        guard case .object(let args)? = backend.initArgs[ref.contextId] else { return XCTFail("no init args") }
        XCTAssertEqual(args["name"], .string("Lime Valley"))
        XCTAssertEqual(args["seed"], .number(4242))
        XCTAssertNotNil(args["now"])
        XCTAssertEqual(model.worlds.first?.ref, ref)
    }

    func testAnEmptyNameAndSeedFallBackToTheDefaults() async throws {
        let model = WorldsModel(backend: backend, applicationId: backend.applicationId)
        let ref = try await model.create(name: "   ", seed: nil)
        XCTAssertEqual(ref.name, "overworld")
        guard case .object(let args)? = backend.initArgs[ref.contextId], case .number(let seed)? = args["seed"] else {
            return XCTFail("no seed")
        }
        XCTAssertTrue(BlocksConstants.seedRange.contains(UInt64(seed)))
    }

    func testListsEveryWorldWithWhoIsPlaying() async throws {
        backend.recording.setHandler { call in
            call.method == "get_players"
                ? .array([
                    .object(["id": "a", "name": "A", "x": 0, "y": 0, "z": 0, "yaw": 0, "pitch": 0, "sel": 0, "online": true]),
                    .object(["id": "b", "name": "B", "x": 0, "y": 0, "z": 0, "yaw": 0, "pitch": 0, "sel": 0, "online": false]),
                ]) : .null
        }
        let creator = WorldsModel(backend: backend, applicationId: backend.applicationId)
        let one = try await creator.create(name: "One", seed: 1)
        let two = try await creator.create(name: "Two", seed: 2)

        let model = WorldsModel(backend: backend, applicationId: backend.applicationId)
        await model.load()
        XCTAssertNil(model.error)
        XCTAssertEqual(Set(model.worlds.map(\.ref)), [one, two])
        XCTAssertEqual(model.worlds.map(\.online), [1, 1])
        XCTAssertEqual(backend.recording.calls("get_players").first?.path, .query)
    }

    func testSignedOutThereIsNothingToList() async {
        backend.hasRelay = false
        let model = WorldsModel(backend: backend, applicationId: backend.applicationId)
        await model.load()
        XCTAssertTrue(model.loaded)
        XCTAssertTrue(model.worlds.isEmpty)
        XCTAssertFalse(model.hasRelay)
        do {
            _ = try await model.create(name: "x", seed: 1)
            XCTFail("created while signed out")
        } catch {
            XCTAssertEqual(error as? BlocksError, .signedOut)
        }
    }

    func testAFailedReadIsShown() async {
        backend.failure = URLError(.notConnectedToInternet)
        let model = WorldsModel(backend: backend, applicationId: backend.applicationId)
        await model.load()
        XCTAssertNotNil(model.error)
        model.dismissError()
        XCTAssertNil(model.error)
    }

    func testJoinsFromAnInvitation() async throws {
        let invitation = try XCTUnwrap(BlocksInvitation.parse(Fixtures.webToken))
        let model = WorldsModel(backend: backend, applicationId: backend.applicationId)
        var didJoin = false
        let ref = try await model.join(invitation) { didJoin = true }
        XCTAssertTrue(didJoin)
        XCTAssertEqual(ref.contextId, String(repeating: "c", count: 64))
        XCTAssertEqual(ref.namespaceId, Fixtures.webNamespace)
        XCTAssertEqual(ref.name, "Lime Valley")
        XCTAssertEqual(backend.log, ["joinNamespace \(Fixtures.webNamespace)"])
    }

    func testInvitesWithALinkForThatWorld() async throws {
        let model = WorldsModel(backend: backend, applicationId: backend.applicationId)
        let ref = try await model.create(name: "Lime Valley", seed: 1)
        let link = try await model.inviteLink(ref)
        let back = try XCTUnwrap(BlocksInvitation.parse(link))
        XCTAssertEqual(back.contextId, ref.contextId)
        XCTAssertEqual(back.groupId, ref.groupId)
        XCTAssertEqual(back.name, "Lime Valley")
        XCTAssertEqual(back.namespaceId, ref.namespaceId)
    }

    func testLeavingAWorldLeavesItsNamespace() async throws {
        let model = WorldsModel(backend: backend, applicationId: backend.applicationId)
        let ref = try await model.create(name: "Gone", seed: 1)
        try await model.leave(ref)
        XCTAssertTrue(model.worlds.isEmpty)
        XCTAssertEqual(backend.log.last, "leaveNamespace \(ref.namespaceId)")
    }
}

@MainActor
final class GameModelTests: XCTestCase {
    private var backend: InMemoryAppBackend!
    private var sent: [String] = []
    private let world = WorldRef(
        contextId: String(repeating: "cc", count: 32), namespaceId: String(repeating: "aa", count: 32),
        groupId: String(repeating: "bb", count: 32), name: "Lime Valley")

    override func setUp() async throws {
        backend = InMemoryAppBackend(account: Fixtures.me)
        backend.recording.setHandler { call in call.method == "world_meta" ? Fixtures.meta() : .null }
        sent = []
    }

    private func model(name: String = "Ana", sensitivity: Double = 1) -> GameModel {
        let model = GameModel(backend: backend, world: world, myId: Fixtures.device, playerName: name, sensitivity: sensitivity)
        model.outbox = { [unowned self] in self.sent.append($0) }
        return model
    }

    private func object(_ text: String?) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(try XCTUnwrap(text).utf8)) as? [String: Any])
    }

    func testJoinsAWorldItWasInvitedTo() async {
        let model = model()
        await model.prepare()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertEqual(backend.log, ["isMember \(world.contextId)", "joinContext \(world.contextId)"])
        await model.prepare()
        XCTAssertEqual(backend.log.last, "isMember \(world.contextId)", "a member does not join again")
    }

    func testAFailedJoinIsShown() async {
        backend.failure = URLError(.timedOut)
        let model = model()
        await model.prepare()
        guard case .failed = model.phase else { return XCTFail("\(model.phase)") }
    }

    func testStartsThePageWhenItIsReady() async throws {
        let model = model(name: "   ", sensitivity: 9)
        model.setInsets(GameInsets(top: 0, left: 47, bottom: 21, right: 47))
        XCTAssertTrue(sent.isEmpty, "nothing goes to a page that is not listening")
        await model.receive(#"{"op":"ready"}"#)
        let start = try object(sent.last)
        XCTAssertEqual(start["type"] as? String, "start")
        XCTAssertEqual(start["contextId"] as? String, world.contextId)
        XCTAssertEqual(start["myId"] as? String, Fixtures.device)
        XCTAssertEqual(start["name"] as? String, "Player", "a blank name is the web app's default")
        XCTAssertEqual(start["worldName"] as? String, "Lime Valley")
        XCTAssertEqual(start["sensitivity"] as? Double, 3, "clamped")
        XCTAssertEqual((start["insets"] as? [String: Any])?["left"] as? Double, 47)
        await model.receive(#"{"op":"loaded"}"#)
        XCTAssertEqual(model.phase, .playing)
    }

    func testAnswersTheGamesCallsThroughTheSession() async throws {
        let model = model()
        await model.receive(#"{"id":1,"op":"query","method":"world_meta","args":{}}"#)
        let answer = try object(sent.last)
        XCTAssertEqual(answer["id"] as? Int, 1)
        XCTAssertEqual(answer["ok"] as? Bool, true)
        XCTAssertEqual((answer["result"] as? [String: Any])?["seed"] as? Int, 1337)
        XCTAssertEqual(backend.recording.calls("world_meta").first?.contextId, world.contextId)
        XCTAssertEqual(backend.recording.calls("world_meta").first?.path, .query)

        await model.receive(#"{"id":2,"op":"execute","method":"init","args":{"name":"x","seed":1,"now":1}}"#)
        let refused = try object(sent.last)
        XCTAssertEqual(refused["id"] as? Int, 2)
        XCTAssertEqual(refused["ok"] as? Bool, false)
        XCTAssertEqual(refused["error"] as? String, "The game may not call init.")
        XCTAssertTrue(backend.recording.calls("init").isEmpty)
    }

    func testAContractRefusalGoesBackToTheCall() async throws {
        backend.recording.setHandler { _ in throw URLError(.cannotConnectToHost) }
        let model = model()
        await model.receive(#"{"id":5,"op":"execute","method":"set_blocks","args":{"edits":[],"now":1}}"#)
        let answer = try object(sent.last)
        XCTAssertEqual(answer["id"] as? Int, 5)
        XCTAssertEqual(answer["ok"] as? Bool, false)
        XCTAssertFalse((answer["error"] as? String ?? "").isEmpty)
    }

    func testForwardsTheWorldsEventsUntilPausedOrStopped() async throws {
        backend.canSubscribe = true
        let model = model()
        await model.receive(#"{"op":"ready"}"#)
        sent = []
        backend.emit(AppContextEvent(contextId: world.contextId, kind: "StateMutation"))
        try await waitFor { self.sent.count == 1 }
        XCTAssertEqual(try object(sent.last)["type"] as? String, "event")

        model.pause()
        XCTAssertEqual(sent.last, BridgeCodec.pause)
        model.pause()
        XCTAssertEqual(sent.filter { $0 == BridgeCodec.pause }.count, 1, "paused once")
        backend.emit(AppContextEvent(contextId: world.contextId, kind: "StateMutation"))
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(sent.last, BridgeCodec.pause, "no events while paused")
        model.resume()
        XCTAssertEqual(sent.last, BridgeCodec.resume)
        model.stop()
    }

    func testMenuHapticsAndFatal() async {
        let model = model()
        var menus = 0
        var haptics: [String] = []
        model.onMenu = { menus += 1 }
        model.onHaptic = { haptics.append($0) }
        await model.receive(#"{"op":"menu"}"#)
        await model.receive(#"{"op":"haptic","style":"light"}"#)
        await model.receive("garbage")
        XCTAssertEqual(menus, 1)
        XCTAssertEqual(haptics, ["light"])
        await model.receive(#"{"op":"fatal","message":"Could not open this world (gone)."}"#)
        XCTAssertEqual(model.phase, .failed("Could not open this world (gone)."))
    }

    func testInvitesToThisWorld() async throws {
        let link = try await model().inviteLink()
        let back = try XCTUnwrap(BlocksInvitation.parse(link))
        XCTAssertEqual(back.contextId, world.contextId)
        XCTAssertEqual(back.groupId, world.groupId)
        XCTAssertEqual(back.name, "Lime Valley")
        XCTAssertEqual(backend.log, ["createInvitation \(world.namespaceId)"])
    }

    func testLeavingTellsTheContract() async {
        let model = model()
        await model.leave()
        XCTAssertEqual(backend.recording.calls("leave").first?.path, .execute)
    }

    private func waitFor(_ condition: @escaping @MainActor () -> Bool) async throws {
        for _ in 0..<100 where !condition() { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertTrue(condition())
    }
}

@MainActor
final class SettingsTests: XCTestCase {
    func testKeepsTheNameAndSensitivity() throws {
        let suite = "blocks-settings-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let settings = PlayerSettings(defaults: defaults)
        XCTAssertEqual(settings.name, "Player")
        XCTAssertEqual(settings.sensitivity, 1)
        settings.name = "  A name far longer than sixteen  "
        settings.sensitivity = 2.5
        let again = PlayerSettings(defaults: defaults)
        XCTAssertEqual(again.sensitivity, 2.5)
        XCTAssertEqual(again.playerName, "A name far longe")
    }

    func testTextHelpers() {
        XCTAssertEqual(BlocksText.seed(" 42 "), 42)
        XCTAssertNil(BlocksText.seed(""))
        XCTAssertNil(BlocksText.seed("0"))
        XCTAssertNil(BlocksText.seed("4294967296"))
        XCTAssertEqual(BlocksText.online(0), "Nobody playing")
        XCTAssertEqual(BlocksText.online(3), "3 playing")
        XCTAssertNil(BlocksText.online(nil))
        XCTAssertEqual(BlocksText.worldName(String(repeating: "x", count: 40)).count, 24)
    }
}
