import MeroKit
import MeroKitUI
import XCTest
@testable import MeroTag

/// The sign-in → space → sign-out state machine, and what happens when the
/// account session ends under the app.
@MainActor
final class SessionTests: XCTestCase {
    private func makeApp(defaults: UserDefaults = isolatedDefaults()) -> AppState {
        AppState(client: makeClient(), preferences: SpacePreferences(defaults: defaults))
    }

    func testLaunchWithNoStoredSessionShowsSignIn() async {
        let app = makeApp()
        XCTAssertEqual(app.phase, .launching)
        await app.restore()
        XCTAssertEqual(app.phase, .signedOut)
        XCTAssertNil(app.account)
    }

    func testCancelledWalletSheetIsNotAnError() async {
        let app = makeApp()
        await app.restore()
        await app.signIn()
        XCTAssertEqual(app.phase, .signedOut)
        XCTAssertNil(app.client.errorMessage, "dismissing the sheet is a choice, not a failure")
    }

    func testCallbackForAnotherSchemeIsIgnored() async {
        let app = makeApp()
        await app.restore()
        await app.handleOpenURL(URL(string: "https://example.com/#credential=x")!)
        XCTAssertEqual(app.phase, .signedOut)
    }

    func testSessionEndedReturnsToSignInWithAReason() throws {
        let app = makeApp()
        app.setPhaseForTesting(.ready)
        app.sessionEnded("Your Calimero session was revoked.")
        XCTAssertEqual(app.phase, .signedOut)
        let notice = try XCTUnwrap(app.sessionNotice)
        XCTAssertTrue(notice.contains("revoked"), "got: \(notice)")
        XCTAssertTrue(notice.hasSuffix("Please sign in again."))
    }

    /// Several calls in flight can each report the dead session.
    func testSessionEndedIsIdempotentOnceSignedOut() {
        let app = makeApp()
        app.setPhaseForTesting(.ready)
        app.sessionEnded("first.")
        let first = app.sessionNotice
        app.sessionEnded("second.")
        XCTAssertEqual(app.sessionNotice, first, "a second report must not overwrite the first reason")
    }

    func testSigningOutDeliberatelyLeavesNoNotice() async {
        let app = makeApp()
        app.setPhaseForTesting(.choosingSpace)
        await app.signOut()
        XCTAssertEqual(app.phase, .signedOut)
        XCTAssertNil(app.sessionNotice)
    }

    func testOpeningASpaceWhileSignedOutGoesBackToSignIn() async {
        let app = makeApp()
        app.setPhaseForTesting(.choosingSpace)
        await app.openSpace(contextId: "ctx", displayName: "Fran")
        XCTAssertEqual(app.phase, .signedOut)
    }

    func testOpenSpaceValidatesInput() async {
        let app = makeApp()
        app.setPhaseForTesting(.choosingSpace)
        await app.openSpace(contextId: "  ", displayName: "Fran")
        XCTAssertEqual(app.spaceError, "Enter the space ID you were given.")
        await app.openSpace(contextId: "ctx", displayName: " ")
        XCTAssertEqual(app.spaceError, "Choose a name others will see.")
    }

    func testTerminalErrorsAreRecognised() {
        let revoked = MeroError.authRevoked(
            reason: "token_revoked", http: HTTPError(status: 403, statusText: "", url: "", headers: [:]))
        XCTAssertNotNil(TrackerStore.sessionEndReason(revoked))
        XCTAssertNotNil(TrackerStore.sessionEndReason(AccountError.notSignedIn("gone")))
        XCTAssertNil(TrackerStore.sessionEndReason(MeroError.network("offline")))
    }

    func testNodeLoginTellsALockoutFromAWrongPassword() {
        let url = "http://localhost:4001"
        func http(_ status: Int, _ headers: [String: String] = [:]) -> MeroError {
            .http(HTTPError(status: status, statusText: "", url: "\(url)/auth/token", headers: headers))
        }
        XCTAssertEqual(
            AppState.nodeLoginMessage(MeroError.authenticationFailed("bad"), url: url),
            "The node refused that username or password.")
        XCTAssertEqual(
            AppState.nodeLoginMessage(http(429, ["retry-after": "30"]), url: url),
            "Too many failed attempts. Try again in 30 seconds.")
        XCTAssertEqual(AppState.nodeLoginMessage(http(429), url: url), "Too many failed attempts. Try again later.")
        XCTAssertEqual(
            AppState.nodeLoginMessage(http(404), url: url), "No node sign-in at \(url). Check the URL and port.")
        XCTAssertEqual(
            AppState.nodeLoginMessage(MeroError.network("offline"), url: url),
            "Can't reach a node at \(url). Is merod running?")
        XCTAssertEqual(
            AppState.nodeLoginMessage(NodeSessionError.badURL, url: url),
            "Enter a full node URL, like http://localhost:4001.")
    }

    func testAContractRefusalShowsTheContractsReason() {
        let refused = MeroError.rpc(
            RpcError(code: -32000, message: "FunctionCallError", type: "FunctionCallError", data: "not a viewer"))
        XCTAssertEqual(TrackerStore.message(for: refused), "not a viewer")
    }

    func testSpacePreferencesRoundTrip() {
        let prefs = SpacePreferences(defaults: isolatedDefaults())
        XCTAssertNil(prefs.space)
        prefs.space = SpaceSelection(contextId: "ctx", displayName: "Fran")
        XCTAssertEqual(prefs.space, SpaceSelection(contextId: "ctx", displayName: "Fran"))
        prefs.space = nil
        XCTAssertNil(prefs.space)
    }
}
