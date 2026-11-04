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

    func testSignInNeedsAnHttpsClusterAddress() async {
        let app = makeApp()
        await app.restore()
        await app.signIn(clusterURL: "http://example.com")
        XCTAssertEqual(app.phase, .signedOut)
        XCTAssertNotNil(app.client.errorMessage)
        XCTAssertNil(app.client.cloud, "nothing is contacted for an address that isn't https")
    }

    func testCreatingAnAccountNeedsAName() async {
        let app = makeApp()
        await app.restore()
        await app.createAccount(clusterURL: "https://cluster.example.com", name: "  ")
        XCTAssertEqual(app.client.errorMessage, "Enter your name for the new account.")
        XCTAssertNil(app.client.cloud)
    }

    func testClusterAddressesAreNormalised() {
        XCTAssertEqual(AppState.validURL("cluster.example.com/", allowHTTP: false), "https://cluster.example.com")
        XCTAssertEqual(AppState.validURL(" https://n1.example.com ", allowHTTP: false), "https://n1.example.com")
        XCTAssertNil(AppState.validURL("http://n1.example.com", allowHTTP: false))
        XCTAssertEqual(AppState.validURL("localhost:2501", allowHTTP: true), "http://localhost:2501")
        XCTAssertNil(AppState.validURL("", allowHTTP: true))
        XCTAssertNil(AppState.validURL("ftp://x", allowHTTP: true))
    }

    func testTheConsentPageReturnsToAnOriginTheNodeAccepts() {
        // The node refuses an app scheme; https (http only on localhost).
        XCTAssertTrue(AppState.consentReturnTo(devCluster: false).hasPrefix("https://"))
        XCTAssertTrue(AppState.consentReturnTo(devCluster: true).hasPrefix("http://localhost"))
    }

    func testANonInviteURLIsIgnored() async {
        let app = makeApp()
        await app.restore()
        await app.handleOpenURL(URL(string: "https://example.com/#credential=x")!)
        XCTAssertEqual(app.phase, .signedOut)
        XCTAssertNil(app.pendingInvite)
    }

    func testSessionEndedReturnsToSignInWithAReason() throws {
        let app = makeApp()
        app.setPhaseForTesting(.ready)
        app.sessionEnded("Your Calimero session ended.")
        XCTAssertEqual(app.phase, .signedOut)
        let notice = try XCTUnwrap(app.sessionNotice)
        XCTAssertTrue(notice.contains("ended"), "got: \(notice)")
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
        await app.openSpace(appId: "app", displayName: "Fran")
        XCTAssertEqual(app.phase, .signedOut)
    }

    func testOpenSpaceValidatesInput() async {
        let app = makeApp()
        app.setPhaseForTesting(.choosingSpace)
        await app.openSpace(appId: "  ", displayName: "Fran")
        XCTAssertEqual(app.spaceError, "Enter the space ID you were given.")
        await app.openSpace(appId: "app", displayName: " ")
        XCTAssertEqual(app.spaceError, "Choose a name others will see.")
    }

    func testTerminalErrorsAreRecognised() {
        XCTAssertNotNil(TrackerStore.sessionEndReason(LoginRequired("refresh refused")))
        XCTAssertNotNil(TrackerStore.sessionEndReason(AccountError.notSignedIn("gone")))
        XCTAssertNil(TrackerStore.sessionEndReason(UnavailableError(code: "NETWORK", message: "offline")))
        XCTAssertNil(TrackerStore.sessionEndReason(AppError("nope")))
    }

    func testAContractRefusalShowsTheContractsReason() {
        XCTAssertEqual(TrackerStore.message(for: AppError("not a viewer")), "not a viewer")
    }

    func testSpacePreferencesRoundTrip() {
        let prefs = SpacePreferences(defaults: isolatedDefaults())
        XCTAssertNil(prefs.space)
        prefs.space = SpaceSelection(appId: "app", displayName: "Fran")
        XCTAssertEqual(prefs.space, SpaceSelection(appId: "app", displayName: "Fran"))
        prefs.space = nil
        XCTAssertNil(prefs.space)
    }
}
