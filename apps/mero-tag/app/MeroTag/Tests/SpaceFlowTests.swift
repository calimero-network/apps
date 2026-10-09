import MeroKit
import MeroKitUI
import XCTest
@testable import MeroTag

/// Create a space, invite people, join from an invite: the app's side of it,
/// with the SDK's account layer behind a fake ``SpaceDirectory``.
@MainActor
final class SpaceFlowTests: XCTestCase {
    private func makeApp(
        _ directory: FakeDirectory, transport: FakeTransport = Fixtures.transport(),
        defaults: UserDefaults = isolatedDefaults()
    ) async -> AppState {
        let app = AppState(
            client: await signedInClient(), preferences: SpacePreferences(defaults: defaults),
            makeTransport: { _ in transport }, makeDirectory: { _ in directory })
        app.syncDelay = 0
        app.setPhaseForTesting(.choosingSpace)
        return app
    }

    func testCreatingASpaceFoundsItThenOpensIt() async {
        let directory = FakeDirectory()
        let transport = Fixtures.transport()
        let app = await makeApp(directory, transport: transport)

        await app.createSpace(name: " Family ", displayName: "Fran")

        XCTAssertEqual(directory.created, ["Family"])
        XCTAssertEqual(app.phase, .ready)
        XCTAssertEqual(app.space, SpaceSelection(contextId: "ctx-new", displayName: "Fran"))
        XCTAssertNil(app.spaceError)
        XCTAssertNil(app.spaceNotice)
        XCTAssertTrue(transport.calls.contains { $0.contextId == "ctx-new" && $0.method == "get_space" })
    }

    func testCreatingNeedsANameAndADisplayName() async {
        let directory = FakeDirectory()
        let app = await makeApp(directory)
        await app.createSpace(name: " ", displayName: "Fran")
        XCTAssertEqual(app.spaceError, "Give the space a name.")
        await app.createSpace(name: "Family", displayName: "")
        XCTAssertEqual(app.spaceError, "Choose a name others will see.")
        XCTAssertTrue(directory.created.isEmpty)
    }

    func testAFailedCreateStaysOnTheScreenWithTheReason() async throws {
        let directory = FakeDirectory()
        directory.failure = SpaceDirectoryError.noRelay
        let app = await makeApp(directory)
        await app.createSpace(name: "Family", displayName: "Fran")
        XCTAssertEqual(app.phase, .choosingSpace)
        let error = try XCTUnwrap(app.spaceError)
        XCTAssertTrue(error.hasPrefix("Couldn't create the space."), error)
        XCTAssertTrue(error.contains("relay"), error)
    }

    func testAnUnhostedSpaceSaysSo() async {
        let directory = FakeDirectory()
        directory.hosted = false
        let app = await makeApp(directory)
        await app.createSpace(name: "Family", displayName: "Fran")
        XCTAssertEqual(app.phase, .ready)
        XCTAssertNotNil(app.spaceNotice)
    }

    func testJoiningFromAnInviteLinkRedeemsItThenOpensTheSpace() async throws {
        let directory = FakeDirectory()
        let app = await makeApp(directory)
        app.receiveInvite(try Fixtures.invite().shareableLink())

        await app.joinSpace(invite: try Fixtures.invite().shareableLink(), displayName: "Ana")

        XCTAssertEqual(directory.joined, [Fixtures.namespace])
        XCTAssertEqual(app.phase, .ready)
        XCTAssertEqual(app.space?.contextId, Fixtures.context)
        XCTAssertNil(app.pendingInvite, "an accepted invite is done with")
    }

    func testSomethingThatIsNotAnInviteIsRefusedBeforeAnyCall() async {
        let directory = FakeDirectory()
        let app = await makeApp(directory)
        await app.joinSpace(invite: "https://links.calimero.network/com.calimero.mero-ar/join?invitation=x", displayName: "Ana")
        XCTAssertTrue(directory.joined.isEmpty)
        XCTAssertEqual(app.spaceError, "That isn't a Mero Tag invite link. Ask the space's owner to send it again.")
    }

    /// No relay before, none after: the refusal is the whole story.
    func testARefusedJoinWithNoRelayShowsWhy() async throws {
        let directory = FakeDirectory()
        directory.failure = AccountError.intentRefused(reason: "invitation expired", retryable: false, status: 409)
        let app = await makeApp(directory)
        await app.joinSpace(invite: try Fixtures.invite().encoded(), displayName: "Ana")
        XCTAssertEqual(app.phase, .choosingSpace)
        let error = try XCTUnwrap(app.spaceError)
        XCTAssertTrue(error.contains("invitation expired"), error)
    }

    func testADeepLinkInviteWaitsThroughSignIn() async throws {
        let defaults = isolatedDefaults()
        SpacePreferences(defaults: defaults).space = SpaceSelection(contextId: "ctx-old", displayName: "Fran")
        let app = AppState(
            client: await signedInClient(restored: false), preferences: SpacePreferences(defaults: defaults),
            makeTransport: { _ in Fixtures.transport() }, makeDirectory: { _ in FakeDirectory() })
        let link = try XCTUnwrap(URL(string: "merotag://join?invitation=\(try Fixtures.invite().encoded())"))

        await app.handleOpenURL(link)
        XCTAssertEqual(app.pendingInvite, link.absoluteString)

        await app.restore()
        XCTAssertEqual(app.phase, .choosingSpace, "the invite is shown instead of reopening the last space")
        XCTAssertNil(app.store)
    }

    func testInvitingSignsForTheOpenSpace() async throws {
        let directory = FakeDirectory()
        let app = await makeApp(directory)
        await app.openSpace(contextId: Fixtures.context, displayName: "Fran")

        let link = try await app.inviteLink()

        XCTAssertEqual(directory.invited, [Fixtures.context])
        XCTAssertEqual(SpaceInvite.decode(pasted: link)?.namespaceId, Fixtures.namespace)
    }

    func testNoSpaceOpenMeansNothingToInviteTo() async {
        let app = await makeApp(FakeDirectory())
        do {
            _ = try await app.inviteLink()
            XCTFail("expected notInASpace")
        } catch {
            XCTAssertEqual(error as? SpaceDirectoryError, .notInASpace)
        }
    }

    /// The real directory goes through the SDK's account layer, which needs a
    /// relay to found on or to read the namespace from.
    func testTheCloudDirectoryNeedsARelay() async {
        let cloud = CloudSignIn(keyStore: .memory(), sessionStore: .memory(), nonces: MemoryWarrantNonceStore())
        let spaces = CloudSpaces(cloud: cloud, connection: nil)
        do {
            _ = try await spaces.createSpace(named: "Family")
            XCTFail("expected noRelay")
        } catch {
            XCTAssertEqual(error as? SpaceDirectoryError, .noRelay)
        }
        do {
            _ = try await spaces.invite(contextId: Fixtures.context, spaceName: "Family")
            XCTFail("expected noRelay")
        } catch {
            XCTAssertEqual(error as? SpaceDirectoryError, .noRelay)
        }
    }
}
