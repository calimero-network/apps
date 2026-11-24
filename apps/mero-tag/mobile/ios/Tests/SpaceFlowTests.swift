import MeroKit
import MeroKitUI
import XCTest
@testable import MeroTag

/// Create a space, invite people, join from an invite: the app's side of it,
/// with the cluster's organizations behind a fake ``SpaceDirectory``.
@MainActor
final class SpaceFlowTests: XCTestCase {
    private func makeApp(
        _ directory: FakeDirectory, transport: FakeTransport = Fixtures.transport(),
        defaults: UserDefaults = isolatedDefaults()
    ) -> AppState {
        let app = signedInApp(transport: transport, directory: directory, defaults: defaults)
        app.setPhaseForTesting(.choosingSpace)
        return app
    }

    func testCreatingASpaceFoundsItThenOpensIt() async {
        let directory = FakeDirectory()
        let transport = Fixtures.transport()
        let app = makeApp(directory, transport: transport)

        await app.createSpace(name: " Family ", displayName: "Fran")

        XCTAssertEqual(directory.created, ["Family"])
        XCTAssertEqual(app.phase, .ready)
        XCTAssertEqual(app.space, SpaceSelection(appId: "app-new", displayName: "Fran"))
        XCTAssertNil(app.spaceError)
        XCTAssertEqual(app.me?.memberId, Fixtures.account)
        XCTAssertTrue(transport.calls.contains { $0.appId == "app-new" && $0.method == "whoami" })
    }

    func testCreatingNeedsANameAndADisplayName() async {
        let directory = FakeDirectory()
        let app = makeApp(directory)
        await app.createSpace(name: " ", displayName: "Fran")
        XCTAssertEqual(app.spaceError, "Give the space a name.")
        await app.createSpace(name: "Family", displayName: "")
        XCTAssertEqual(app.spaceError, "Choose a name others will see.")
        XCTAssertTrue(directory.created.isEmpty)
    }

    func testAFailedCreateStaysOnTheScreenWithTheReason() async throws {
        let directory = FakeDirectory()
        directory.failure = AppError("the package is not published")
        let app = makeApp(directory)
        await app.createSpace(name: "Family", displayName: "Fran")
        XCTAssertEqual(app.phase, .choosingSpace)
        let error = try XCTUnwrap(app.spaceError)
        XCTAssertTrue(error.hasPrefix("Couldn't create the space."), error)
        XCTAssertTrue(error.contains("not published"), error)
    }

    func testJoiningFromAnInviteLinkRedeemsItThenOpensTheSpace() async throws {
        let directory = FakeDirectory()
        let app = makeApp(directory)
        app.receiveInvite(try Fixtures.invite().shareableLink())

        await app.joinSpace(invite: try Fixtures.invite().shareableLink(), displayName: "Ana")

        XCTAssertEqual(directory.joined, [Fixtures.invite().token])
        XCTAssertEqual(app.phase, .ready)
        XCTAssertEqual(app.space?.appId, Fixtures.app)
        XCTAssertNil(app.pendingInvite, "an accepted invite is done with")
    }

    func testSomethingThatIsNotAnInviteIsRefusedBeforeAnyCall() async {
        let directory = FakeDirectory()
        let app = makeApp(directory)
        await app.joinSpace(invite: "https://links.calimero.network/com.calimero.mero-ar/join?invitation=x", displayName: "Ana")
        XCTAssertTrue(directory.joined.isEmpty)
        XCTAssertEqual(app.spaceError, "That isn't a Mero Tag invite link. Ask the space's owner to send it again.")
    }

    /// An already-used invite is refused, but a member can still open the space.
    func testARefusedRedeemStillOpensASpaceTheAccountCanReach() async throws {
        let directory = FakeDirectory()
        directory.failure = CalimeroError(status: 409, code: "INVITE_USED", message: "invite already used")
        let app = makeApp(directory)
        await app.joinSpace(invite: try Fixtures.invite().encoded(), displayName: "Ana")
        XCTAssertEqual(app.phase, .ready)
    }

    func testARefusedRedeemForASpaceOutOfReachShowsWhy() async throws {
        let directory = FakeDirectory()
        directory.failure = CalimeroError(status: 410, code: "INVITE_EXPIRED", message: "invitation expired")
        let transport = Fixtures.transport()
        transport.failures["whoami"] = NotFound("no such app")
        let app = makeApp(directory, transport: transport)
        await app.joinSpace(invite: try Fixtures.invite().encoded(), displayName: "Ana")
        XCTAssertEqual(app.phase, .choosingSpace)
        let error = try XCTUnwrap(app.spaceError)
        XCTAssertTrue(error.contains("invitation expired"), error)
    }

    func testADeepLinkInviteWaitsThroughSignIn() async throws {
        let defaults = isolatedDefaults()
        SpacePreferences(defaults: defaults).space = SpaceSelection(appId: "app-old", displayName: "Fran")
        let app = signedInApp(defaults: defaults)
        let link = try XCTUnwrap(URL(string: "merotag://join?invitation=\(try Fixtures.invite().encoded())"))

        await app.handleOpenURL(link)
        XCTAssertEqual(app.pendingInvite, link.absoluteString)

        await app.didSignIn()
        XCTAssertEqual(app.phase, .choosingSpace, "the invite is shown instead of reopening the last space")
        XCTAssertNil(app.store)
    }

    func testInvitingIsForTheOpenSpace() async throws {
        let directory = FakeDirectory()
        let app = makeApp(directory)
        await app.openSpace(appId: Fixtures.app, displayName: "Fran")

        let link = try await app.inviteLink()

        XCTAssertEqual(directory.invited, [Fixtures.app])
        XCTAssertEqual(SpaceInvite.decode(pasted: link)?.orgId, Fixtures.org)
    }

    func testNoSpaceOpenMeansNothingToInviteTo() async {
        let app = makeApp(FakeDirectory())
        do {
            _ = try await app.inviteLink()
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? SpaceDirectoryError, .notInAnOrganization)
        }
    }

    /// Without a cluster connection the real defaults have nothing to talk to.
    func testNotConnectedSaysSo() async {
        let app = AppState(client: makeClient(), preferences: SpacePreferences(defaults: isolatedDefaults()))
        app.signInForTesting(account: Fixtures.account)
        app.setPhaseForTesting(.choosingSpace)
        await app.createSpace(name: "Family", displayName: "Fran")
        XCTAssertEqual(app.spaceError, SpaceDirectoryError.notConnected.errorDescription)
    }

    // MARK: A saved space the cluster can't serve right now

    /// Sign in with a saved space, as a restored session does.
    private func launch(_ transport: FakeTransport) async -> AppState {
        let defaults = isolatedDefaults()
        SpacePreferences(defaults: defaults).space = SpaceSelection(appId: Fixtures.app, displayName: "Fran")
        let app = signedInApp(transport: transport, defaults: defaults)
        await app.didSignIn()
        return app
    }

    /// Not reaching the space is not "you have no space": it is offered back.
    func testAnUnreachableSavedSpaceIsOfferedBackNotTreatedAsMissing() async throws {
        let transport = Fixtures.transport()
        transport.failures["whoami"] = UnavailableError(code: "NETWORK", message: "offline")
        let app = await launch(transport)

        XCTAssertEqual(app.phase, .choosingSpace)
        XCTAssertEqual(app.unreachableSpace, SpaceSelection(appId: Fixtures.app, displayName: "Fran"))
        let error = try XCTUnwrap(app.spaceError)
        XCTAssertFalse(error.contains("member"), "a failed read says nothing about membership: \(error)")
        XCTAssertTrue(error.contains("Can't reach your Calimero cluster"), error)

        // The cluster is back: one tap reopens the same space.
        transport.failures = [:]
        await app.retryUnreachableSpace()
        XCTAssertEqual(app.phase, .ready)
        XCTAssertNil(app.unreachableSpace)
        XCTAssertNil(app.spaceError)
        XCTAssertEqual(app.space?.appId, Fixtures.app)
    }

    func testAClusterThatCannotServeYetIsAlsoRetryable() async {
        let transport = Fixtures.transport()
        transport.failures["whoami"] = UnavailableError(code: "MIGRATING", message: "migrating")
        let app = await launch(transport)
        XCTAssertNotNil(app.unreachableSpace)
    }

    /// A refusal is an answer: that one points at membership, with no retry.
    func testARefusedSavedSpaceAsksAboutMembership() async throws {
        let transport = Fixtures.transport()
        transport.failures["whoami"] = NotFound("no such app")
        let app = await launch(transport)
        XCTAssertEqual(app.phase, .choosingSpace)
        XCTAssertNil(app.unreachableSpace)
        let error = try XCTUnwrap(app.spaceError)
        XCTAssertTrue(error.contains("member"), error)
    }
}
