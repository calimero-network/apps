import XCTest
import MeroKit
@testable import MeroAR

/// The app's flows end to end, against ``FixtureNode``: an in-memory node with
/// Mero AR's contract, so the real ``AppState``, ``NodeHomes``,
/// ``MeroARService`` and ``SceneStore`` run with no network. Two `AppState`s
/// on one fixture are two people (Maya, who builds, and Sam, who is invited).
@MainActor
final class AppFlowTests: XCTestCase {
    private var apps: [AppState] = []

    override func setUp() {
        super.setUp()
        FixtureNode.reset()
    }

    override func tearDown() {
        apps.forEach { $0.leaveRoom() }
        apps = []
        super.tearDown()
    }

    /// A signed-in person with a nickname, in the lobby.
    private func person(_ name: String) async -> AppState {
        let defaults = UserDefaults(suiteName: "AppFlowTests-\(name)-\(UUID().uuidString)")!
        let app = AppState(defaults: defaults, urlSession: FixtureNode.session)
        app.syncAttempts = 3
        app.syncDelay = 50_000_000
        app.displayName = name
        await app.connectNode(FixtureNode.baseURL, username: name.lowercased(), password: "pw")
        XCTAssertEqual(app.phase, .lobby, app.nodeError ?? "")
        apps.append(app)
        return app
    }

    /// Maya's home "Our flat" with "Living room", Maya inside it.
    private func mayaInHerRoom() async -> AppState {
        let maya = await person("Maya")
        await maya.createHome(named: "Our flat", firstRoom: "Living room")
        XCTAssertNil(maya.roomError)
        XCTAssertEqual(maya.phase, .inRoom)
        return maya
    }

    private func store(_ app: AppState, file: StaticString = #filePath, line: UInt = #line) throws -> SceneStore {
        try XCTUnwrap(app.store, "not in a room", file: file, line: line)
    }

    private func sampleRoom() -> RoomModel {
        func wall(_ id: String, _ x: Float, _ z: Float, turned: Bool) -> RoomModel.Surface {
            let c: Float = turned ? 0 : 1, s: Float = turned ? 1 : 0
            return RoomModel.Surface(
                id: id, dimensions: [4, 2.5, 0], transform: [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, 1.25, z, 1])
        }
        return RoomModel(
            sample: true, name: "Test room",
            walls: [wall("n", 0, -2, turned: false), wall("s", 0, 2, turned: false),
                    wall("e", 2, 0, turned: true), wall("w", -2, 0, turned: true)],
            objects: [RoomModel.Item(id: "sofa", category: "sofa", dimensions: [2, 0.8, 0.9],
                                     transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0.4, -1.5, 1])])
    }

    // MARK: - Homes and rooms

    func testANewPersonHasNoHomesAndNoError() async {
        let maya = await person("Maya")
        XCTAssertTrue(maya.homes.isEmpty)
        XCTAssertNil(maya.homesError, "an empty node was reported as a failure")
        XCTAssertTrue(maya.canCreateHomes)
    }

    func testCreatingAHomeEntersItsFirstRoomAsAdmin() async throws {
        let maya = await mayaInHerRoom()
        let room = try store(maya)
        XCTAssertEqual(room.room?.name, "Living room")
        XCTAssertEqual(room.myRole, "admin")
        XCTAssertTrue(room.canEdit)
        XCTAssertEqual(room.members.map(\.username), ["Maya"], "joining didn't put the nickname on the roster")

        maya.leaveRoom()
        XCTAssertEqual(maya.phase, .lobby)
        XCTAssertEqual(maya.homes.map(\.name), ["Our flat"])
        XCTAssertEqual(maya.homes.first?.rooms.map(\.name), ["Living room"])
        XCTAssertEqual(maya.homes.first?.memberCount, 1)
        XCTAssertTrue(maya.looseRooms.isEmpty)
        XCTAssertEqual(maya.recentRooms.first?.name, "Living room")
    }

    func testASecondRoomGoesIntoTheSameHome() async throws {
        let maya = await mayaInHerRoom()
        maya.leaveRoom()
        let home = try XCTUnwrap(maya.homes.first)
        await maya.createRoom(named: "Bedroom", inHome: home.id)
        XCTAssertNil(maya.roomError)
        XCTAssertEqual(try store(maya).room?.name, "Bedroom")
        maya.leaveRoom()
        await maya.loadHomes()
        XCTAssertEqual(maya.homes.count, 1)
        XCTAssertEqual(Set(maya.homes.first?.rooms.map(\.name) ?? []), ["Living room", "Bedroom"])
    }

    func testCreatingNeedsNames() async {
        let maya = await person("Maya")
        await maya.createHome(named: "  ", firstRoom: "Living room")
        XCTAssertEqual(maya.roomError, "Give the home a name.")
        await maya.createHome(named: "Our flat", firstRoom: "")
        XCTAssertEqual(maya.roomError, "Name the first room.")
        await maya.createRoom(named: " ", inHome: "whatever")
        XCTAssertEqual(maya.roomError, "Give the room a name.")
        XCTAssertTrue(maya.homes.isEmpty, "an invalid form still created something")
        XCTAssertEqual(maya.phase, .lobby)
    }

    func testSomeoneElsesHomeIsInvisibleAndItsRoomsClosed() async throws {
        let maya = await mayaInHerRoom()
        let roomId = try store(maya).service.contextId
        let sam = await person("Sam")
        XCTAssertTrue(sam.homes.isEmpty, "a home listed for someone who isn't in it")
        await sam.enter(roomOrInvite: roomId)
        XCTAssertNotNil(sam.roomError, "a stranger opened a room by its id")
        XCTAssertEqual(sam.phase, .lobby)
    }

    // MARK: - Invitations

    func testAHomeInviteListsTheHomeForTheInvitee() async throws {
        let maya = await mayaInHerRoom()
        maya.leaveRoom()
        let home = try XCTUnwrap(maya.homes.first)
        let link = try await maya.inviteLink(toHome: home)
        let invite = try XCTUnwrap(RoomInvite.decode(pasted: link))
        XCTAssertTrue(invite.isHomeInvite)
        XCTAssertEqual(invite.homeName, "Our flat")

        let sam = await person("Sam")
        await sam.enter(roomOrInvite: link)
        XCTAssertNil(sam.roomError)
        XCTAssertEqual(sam.phase, .lobby, "a home invite should land in the lobby, not a room")
        XCTAssertEqual(sam.homeNotice, "You joined Our flat. Pick a room to enter.")
        XCTAssertEqual(sam.homes.map(\.name), ["Our flat"])
        XCTAssertEqual(sam.homes.first?.rooms.map(\.name), ["Living room"])
        XCTAssertEqual(sam.homes.first?.memberCount, 2)

        let room = try XCTUnwrap(sam.homes.first?.rooms.first)
        await sam.enter(roomOrInvite: room.id)
        XCTAssertEqual(sam.phase, .inRoom)
        XCTAssertEqual(try store(sam).myRole, "viewer", "an invitee should start view-only")
    }

    func testARoomInviteEntersTheRoomDirectly() async throws {
        let maya = await mayaInHerRoom()
        let link = try await store(maya).service.createRoomInvite().shareableLink()
        let invite = try XCTUnwrap(RoomInvite.decode(pasted: link))
        XCTAssertFalse(invite.isHomeInvite)
        XCTAssertEqual(invite.roomName, "Living room")
        XCTAssertEqual(invite.homeName, "Our flat")

        let sam = await person("Sam")
        await sam.enter(roomOrInvite: link)
        XCTAssertNil(sam.roomError)
        XCTAssertEqual(sam.phase, .inRoom)
        let room = try store(sam)
        XCTAssertEqual(room.room?.name, "Living room")
        XCTAssertEqual(Set(room.members.map(\.username)), ["Maya", "Sam"])
        XCTAssertEqual(sam.recentRooms.first?.name, "Living room")
    }

    func testAnInviteToAnotherHomeIsRefused() async throws {
        let maya = await mayaInHerRoom()
        maya.leaveRoom()
        let home = try XCTUnwrap(maya.homes.first)
        let realLink = try await maya.inviteLink(toHome: home)
        let real = try XCTUnwrap(RoomInvite.decode(pasted: realLink))
        // The same signed invitation, pointed at a home it wasn't minted for.
        let forged = RoomInvite(
            namespaceId: String(repeating: "ee", count: 32), contextId: "", roomName: "", homeName: "Elsewhere",
            invitation: real.invitation)

        let sam = await person("Sam")
        await sam.enter(roomOrInvite: try forged.shareableLink())
        XCTAssertNotNil(sam.roomError)
        XCTAssertTrue(sam.homes.isEmpty)
    }

    func testJoiningTwiceIsHarmless() async throws {
        let maya = await mayaInHerRoom()
        maya.leaveRoom()
        let link = try await maya.inviteLink(toHome: try XCTUnwrap(maya.homes.first))
        let sam = await person("Sam")
        await sam.enter(roomOrInvite: link)
        await sam.enter(roomOrInvite: link)
        XCTAssertNil(sam.roomError)
        XCTAssertEqual(sam.homes.count, 1)
    }

    // MARK: - Objects, roles and sharing

    func testObjectsPlacedByOnePersonAppearForTheOther() async throws {
        let maya = await mayaInHerRoom()
        let mine = try store(maya)
        await mine.addObject(kind: "cube", transform: .at(Vec3(0.5, 0, -1)), color: "#8B5CF6")
        await mine.addObject(kind: "text", content: "Hello", transform: .at(Vec3(0, 1, -1)), color: "#22D3EE")
        XCTAssertNil(mine.lastError)
        let cube = try XCTUnwrap(mine.sortedObjects.first { $0.data.kind == "cube" })
        await mine.updateTransform(id: cube.id, transform: cube.transform.moved(0.5, 0, 0).rotatedY(90))
        await mine.updateColor(id: cube.id, color: "#F472B6")

        let link = try await mine.service.createRoomInvite().shareableLink()
        let sam = await person("Sam")
        await sam.enter(roomOrInvite: link)
        let theirs = try store(sam)
        XCTAssertEqual(theirs.objects.count, 2)
        let seen = try XCTUnwrap(theirs.objects[cube.id])
        XCTAssertEqual(seen.transform.position.x, 1.0, accuracy: 1e-6)
        XCTAssertEqual(seen.color, "#F472B6")
        XCTAssertEqual(seen.createdBy, mine.memberId, "the placer isn't credited")
        XCTAssertEqual(theirs.name(of: seen.createdBy), "Maya")
        XCTAssertEqual(theirs.sortedObjects.first { $0.data.kind == "text" }?.data.content, "Hello")
    }

    func testAViewerCantEditUntilAnAdminGrantsIt() async throws {
        let maya = await mayaInHerRoom()
        let mine = try store(maya)
        let sam = await person("Sam")
        await sam.enter(roomOrInvite: try await mine.service.createRoomInvite().shareableLink())
        let theirs = try store(sam)
        XCTAssertFalse(theirs.canEdit)

        await theirs.addObject(kind: "cube", transform: .at(Vec3(0, 0, 0)), color: "#8B5CF6")
        XCTAssertTrue(theirs.objects.isEmpty, "a refused add stayed on screen")
        XCTAssertEqual(theirs.lastError?.hasPrefix("view-only"), true, theirs.lastError ?? "no error shown")

        await mine.refreshRoster()
        XCTAssertEqual(mine.roles.first { $0.member == theirs.memberId }?.role, "viewer")
        await mine.setEditor(theirs.memberId, enabled: true)
        await theirs.refreshRole()
        XCTAssertTrue(theirs.canEdit)
        await theirs.addObject(kind: "sphere", transform: .at(Vec3(0, 0, 0)), color: "#8B5CF6")
        await mine.refresh()
        XCTAssertEqual(mine.objects.count, 1)

        await mine.setEditor(theirs.memberId, enabled: false)
        await theirs.refreshRole()
        XCTAssertFalse(theirs.canEdit, "revoking editor didn't take")
    }

    func testALockKeepsOthersOffAnObject() async throws {
        let maya = await mayaInHerRoom()
        let mine = try store(maya)
        await mine.addObject(kind: "cube", transform: .at(Vec3(0, 0, 0)), color: "#8B5CF6")
        let id = try XCTUnwrap(mine.sortedObjects.first?.id)
        let sam = await person("Sam")
        await sam.enter(roomOrInvite: try await mine.service.createRoomInvite().shareableLink())
        let theirs = try store(sam)
        await mine.setEditor(theirs.memberId, enabled: true)
        await theirs.refreshRole()

        await mine.setLocked(id: id, true)
        await theirs.refresh()
        XCTAssertTrue(theirs.isLockedByOther(id))
        await theirs.move(id: id, to: SIMD3(1, 0, 1))
        await mine.refresh()
        XCTAssertEqual(mine.objects[id]?.transform.position.x ?? -1, 0, accuracy: 1e-6, "a locked object moved")

        await mine.setLocked(id: id, false)
        await theirs.refresh()
        await theirs.move(id: id, to: SIMD3(1, 0, 1))
        await mine.refresh()
        XCTAssertEqual(mine.objects[id]?.transform.position.x ?? -1, 1, accuracy: 1e-6)
    }

    func testDeletingAnObjectRemovesItForEveryone() async throws {
        let maya = await mayaInHerRoom()
        let mine = try store(maya)
        await mine.addObject(kind: "marker", transform: .at(Vec3(0, 0, 0)), color: "#8B5CF6")
        let id = try XCTUnwrap(mine.sortedObjects.first?.id)
        let sam = await person("Sam")
        await sam.enter(roomOrInvite: try await mine.service.createRoomInvite().shareableLink())
        XCTAssertEqual(try store(sam).objects.count, 1)
        await mine.deleteObject(id: id)
        try await store(sam).refresh()
        XCTAssertTrue(try store(sam).objects.isEmpty)
    }

    func testNotesAreSharedAndOnlyTheirAuthorOrAnAdminDeletesThem() async throws {
        let maya = await mayaInHerRoom()
        let mine = try store(maya)
        await mine.addComment(text: "Sofa goes here", position: Vec3(0, 0.3, -1))
        let sam = await person("Sam")
        await sam.enter(roomOrInvite: try await mine.service.createRoomInvite().shareableLink())
        let theirs = try store(sam)
        XCTAssertEqual(theirs.comments.map(\.text), ["Sofa goes here"])
        XCTAssertEqual(theirs.name(of: theirs.comments[0].author), "Maya")

        await mine.setEditor(theirs.memberId, enabled: true)
        await theirs.refreshRole()
        await theirs.deleteComment(id: theirs.comments[0].id)
        XCTAssertNotNil(theirs.lastError, "an editor deleted someone else's note")
        await mine.deleteComment(id: mine.comments[0].id)
        await theirs.refreshComments()
        XCTAssertTrue(theirs.comments.isEmpty)
    }

    // MARK: - The 3D room

    func testA3DRoomSharedByOnePersonLoadsForTheOther() async throws {
        let maya = await mayaInHerRoom()
        let mine = try store(maya)
        let model = sampleRoom()
        let published = await mine.publishRoomScan(model)
        XCTAssertTrue(published, mine.lastError ?? "")
        XCTAssertEqual(mine.roomScan?.version, 1)
        XCTAssertEqual(mine.roomModel, model)

        let sam = await person("Sam")
        await sam.enter(roomOrInvite: try await mine.service.createRoomInvite().shareableLink())
        let theirs = try store(sam)
        XCTAssertEqual(theirs.roomModel, model, "the peer didn't get the same room model")
        XCTAssertEqual(theirs.roomScan?.scannedBy, mine.memberId)
        XCTAssertEqual(theirs.roomScan?.sample, true)
        XCTAssertEqual(theirs.roomScan?.objectCount, 1)
        XCTAssertEqual(theirs.roomScan?.width ?? 0, 4, accuracy: 0.01)

        // A rescan replaces it, with a new version.
        var rescan = model
        rescan.objects = []
        _ = await mine.publishRoomScan(rescan)
        await theirs.refreshRoomScan()
        XCTAssertEqual(theirs.roomScan?.version, 2)
        XCTAssertEqual(theirs.roomModel?.objects.count, 0)

        await mine.clearRoomScan()
        await theirs.refreshRoomScan()
        XCTAssertNil(theirs.roomScan)
        XCTAssertNil(theirs.roomModel)
    }

    func testAViewerCantShareA3DRoom() async throws {
        let maya = await mayaInHerRoom()
        let sam = await person("Sam")
        await sam.enter(roomOrInvite: try await store(maya).service.createRoomInvite().shareableLink())
        let theirs = try store(sam)
        let published = await theirs.publishRoomScan(sampleRoom())
        XCTAssertFalse(published)
        XCTAssertNil(theirs.roomScan)
    }

    func testTheARWorldMapIsSharedAsABlob() async throws {
        let maya = await mayaInHerRoom()
        let mine = try store(maya)
        let map = Data((0..<4096).map { UInt8($0 % 251) })
        let shared = await mine.publishWorldMap(map)
        XCTAssertTrue(shared)

        let sam = await person("Sam")
        await sam.enter(roomOrInvite: try await mine.service.createRoomInvite().shareableLink())
        let theirs = try store(sam)
        let blob = try XCTUnwrap(theirs.room?.worldMapBlob)
        XCTAssertFalse(blob.isEmpty)
        let downloaded = try await theirs.service.downloadWorldMap(blobId: blob)
        XCTAssertEqual(downloaded, map)
    }

    // MARK: - Nicknames

    func testANewNodeSessionHasNoNicknameUntilChosen() async {
        let defaults = UserDefaults(suiteName: "AppFlowTests-nick-\(UUID().uuidString)")!
        let app = AppState(defaults: defaults, urlSession: FixtureNode.session)
        await app.connectNode(FixtureNode.baseURL, username: "admin", password: "pw")
        XCTAssertFalse(app.hasNickname, "the node's admin username was taken as the nickname")
        await app.setNickname("  Robin  ")
        XCTAssertEqual(app.displayName, "Robin")
        XCTAssertTrue(app.hasNickname)
        XCTAssertEqual(defaults.string(forKey: "meroar.username"), "Robin", "the nickname wasn't kept")
    }

    func testChangingTheNicknameInARoomUpdatesItForEveryone() async throws {
        let maya = await mayaInHerRoom()
        let mine = try store(maya)
        let sam = await person("Sam")
        await sam.enter(roomOrInvite: try await mine.service.createRoomInvite().shareableLink())

        await maya.setNickname("Maya R")
        XCTAssertNil(mine.lastError)
        XCTAssertEqual(mine.name(of: mine.memberId), "Maya R")
        let theirs = try store(sam)
        await theirs.refreshRoster()
        XCTAssertEqual(theirs.name(of: mine.memberId), "Maya R")
    }

    // MARK: - Sign-out

    func testSigningOutForgetsTheHomes() async {
        let maya = await mayaInHerRoom()
        await maya.signOut()
        XCTAssertEqual(maya.phase, .signedOut)
        XCTAssertTrue(maya.homes.isEmpty)
        XCTAssertNil(maya.store)
    }

    func testAWrongPasswordStaysOnSignIn() async {
        let app = AppState(
            defaults: UserDefaults(suiteName: "AppFlowTests-pw-\(UUID().uuidString)")!, urlSession: FixtureNode.session)
        await app.connectNode(FixtureNode.baseURL, username: "maya", password: "wrong")
        XCTAssertNotEqual(app.phase, .lobby)
        XCTAssertNotNil(app.nodeError)
    }
}
