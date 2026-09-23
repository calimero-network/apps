import XCTest
@testable import MeroKit

/// The status/reason table is the contract this client got wrong, so it is
/// asserted entry by entry rather than trusted.
final class AuthFailureTests: XCTestCase {
    private func classify(_ status: Int, _ reason: String?) -> AuthFailure? {
        var headers: [String: String] = [:]
        if let reason { headers["X-Auth-Error"] = reason }
        let response = HTTPURLResponse(
            url: URL(string: "http://node.test/sse")!,
            statusCode: status, httpVersion: nil, headerFields: headers)!
        return response.authFailure
    }

    /// The one that mattered: core answers a revoked family with a **403**, not
    /// a 401. A client watching only 401 keeps the dead token and retries it.
    func testRevokedIsA403AndIsTerminal() {
        let failure = classify(403, "token_revoked")
        XCTAssertEqual(failure, .tokenRevoked)
        XCTAssertTrue(failure?.isTerminal == true)
        XCTAssertFalse(failure?.isRefreshable == true)
    }

    func testExpiredIsTheOnlyRefreshableReason() {
        XCTAssertEqual(classify(401, "token_expired"), .tokenExpired)
        XCTAssertTrue(AuthFailure.tokenExpired.isRefreshable)
        for other: AuthFailure in [.tokenReuse, .invalidToken, .tokenRevoked, .permissionDenied, .invalidNode] {
            XCTAssertFalse(other.isRefreshable, "\(other) must not be refreshable")
            XCTAssertTrue(other.isTerminal, "\(other) must end the session")
        }
    }

    func testPermissionDeniedIsA403() {
        XCTAssertEqual(classify(403, "permission_denied"), .permissionDenied)
    }

    /// Reuse arrives as a 401 even though the family is already gone, so the
    /// header — not the status — has to decide.
    func testReuseIsA401ButStillTerminal() {
        let failure = classify(401, "token_reuse")
        XCTAssertEqual(failure, .tokenReuse)
        XCTAssertTrue(failure?.isTerminal == true)
    }

    func testHeaderIsCaseAndWhitespaceInsensitive() {
        XCTAssertEqual(classify(403, "  Token_Revoked "), .tokenRevoked)
    }

    /// Behind a proxy that drops unknown headers there is nothing to read. A 403
    /// on an authenticated route is terminal whichever of the three reasons it
    /// was, so the pessimistic fallback is the correct one.
    func testBareForbiddenIsTreatedAsTerminal() {
        let failure = classify(403, nil)
        XCTAssertEqual(failure, .tokenRevoked)
        XCTAssertTrue(failure?.isTerminal == true)
    }

    /// A bare 401 costs one refresh attempt; if the session really is dead the
    /// refresh reports it.
    func testBareUnauthorizedIsTreatedAsExpiry() {
        XCTAssertEqual(classify(401, nil), .tokenExpired)
    }

    func testSuccessAndOtherErrorsAreNotAuthFailures() {
        XCTAssertNil(classify(200, nil))
        XCTAssertNil(classify(500, "token_revoked"))
        XCTAssertNil(classify(400, "invalid_request"))
    }
}
