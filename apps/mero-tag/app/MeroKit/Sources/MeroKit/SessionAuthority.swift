import Foundation

/// Owns the access token's lifecycle: hands it out, refreshes it exactly once
/// when it expires, and latches the session dead when the node says it is.
///
/// ## Why this exists
///
/// Core mints access tokens with a **one hour** expiry and refresh tokens with
/// thirty days. MeroKit stored the refresh token and never used it, so this app
/// worked for an hour and then stopped — which on a background location tracker
/// means the phone keeps sampling GPS and every write is refused, silently, for
/// the rest of the day.
///
/// ## Why a generation counter, not just a single-flight gate
///
/// `POST /auth/refresh` is SINGLE USE. Replaying a consumed refresh token is
/// read as theft: core revokes the entire token family and answers
/// `token_reuse`. So a client that refreshes twice does not merely waste a
/// round trip — it logs the user out and cannot log them back in without a
/// password.
///
/// A plain "only one refresh in flight" gate does not prevent that. Requests
/// issued *before* a rotation land afterwards, each carrying a 401 for the token
/// that has already been replaced; the gate is open again by then, so each of
/// them opens a second refresh with the now-consumed token. The gate has to know
/// not just whether a refresh is running but *which* token the 401 was about.
///
/// Every credential handed out is stamped with a generation. A 401 only earns a
/// refresh if its generation is still the current one; a 401 about an older
/// generation is answered with the token that already replaced it.
public actor SessionAuthority {
    private let store: TokenStore
    private let session: URLSession

    private var generation: Int = 0
    private var inFlight: Task<Void, Error>?
    /// Set once the node has told us the session cannot be recovered. Every
    /// later call fails fast rather than hammering a dead credential.
    private var deadReason: AuthFailure?

    /// Invoked once, on the first terminal failure. The app uses it to drop back
    /// to the login screen instead of showing a frozen map.
    private var onSessionEnded: (@Sendable (AuthFailure) -> Void)?

    public init(store: TokenStore, session: URLSession = .shared) {
        self.store = store
        self.session = session
    }

    public func setSessionEndedHandler(_ handler: (@Sendable (AuthFailure) -> Void)?) {
        onSessionEnded = handler
    }

    /// The bearer token to send, stamped with the generation it belongs to.
    public func credential() -> (token: String?, generation: Int) {
        (store.accessToken, generation)
    }

    /// Forget a dead session so a fresh login can start clean.
    public func reset() {
        deadReason = nil
        inFlight = nil
        generation += 1
    }

    /// React to an auth refusal on `generation`.
    ///
    /// Returns the token to retry with, or throws `MeroError.authRevoked` when
    /// the session is over. A caller retries **at most once** on the returned
    /// token: a second refusal for the same generation means the refusal was
    /// never about expiry.
    public func recover(from failure: AuthFailure, generation seen: Int) async throws -> String {
        if let deadReason { throw MeroError.authRevoked(deadReason) }
        guard failure.isRefreshable else { throw die(failure) }

        // A 401 about a token we have already replaced. Answering it with the
        // current token is the whole point of the generation stamp — refreshing
        // again would replay a consumed refresh token and revoke the family.
        if seen < generation, let token = store.accessToken { return token }

        if let inFlight {
            try await inFlight.value
            guard let token = store.accessToken else { throw MeroError.notConfigured }
            return token
        }

        let task = Task { try await self.performRefresh() }
        inFlight = task
        defer { inFlight = nil }
        try await task.value
        guard let token = store.accessToken else { throw MeroError.notConfigured }
        return token
    }

    /// Mark the session dead, clear the credentials and notify once.
    @discardableResult
    private func die(_ failure: AuthFailure) -> MeroError {
        if deadReason == nil {
            deadReason = failure
            // Keep `nodeUrl`: the login screen should come back pointed at the
            // node the user was already using.
            store.accessToken = nil
            store.refreshToken = nil
            onSessionEnded?(failure)
        }
        return MeroError.authRevoked(deadReason ?? failure)
    }

    /// `POST {node}/auth/refresh` — body is exactly `{access_token,
    /// refresh_token}`. That request type is `deny_unknown_fields` (one of the
    /// 37 admin/auth bodies core closed at rc.38), so a single extra key is a
    /// 400 rather than a refreshed session.
    private func performRefresh() async throws {
        guard let base = store.nodeUrl,
              let access = store.accessToken,
              let refresh = store.refreshToken,
              let url = URL(string: "\(trim(base))/auth/refresh")
        else { throw MeroError.notConfigured }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(RefreshBody(access_token: access, refresh_token: refresh))

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            // A refresh that could not be *delivered* says nothing about the
            // session. Leave it alive so the next attempt, on a better network,
            // can still recover it.
            throw MeroError.transport(error.localizedDescription)
        }

        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            // `token_reuse` here is the failure this class exists to avoid: the
            // family is already gone, and there is nothing to retry.
            throw die(http.authFailure ?? .invalidToken)
        }

        let decoded = try? JSONDecoder().decode(RefreshResponse.self, from: data)
        guard let access = decoded?.data?.access_token, !access.isEmpty else {
            throw die(.invalidToken)
        }
        store.accessToken = access
        // The refresh token rotates with the pair. Dropping the new one would
        // leave us replaying the consumed one at the next expiry — the exact
        // move that revokes the family.
        if let rotated = decoded?.data?.refresh_token, !rotated.isEmpty {
            store.refreshToken = rotated
        }
        generation += 1
    }

    private struct RefreshBody: Encodable {
        let access_token: String
        let refresh_token: String
    }

    private struct RefreshResponse: Decodable {
        struct Payload: Decodable { let access_token: String?; let refresh_token: String? }
        let data: Payload?
    }

    private func trim(_ s: String) -> String {
        var t = s; while t.hasSuffix("/") { t.removeLast() }; return t
    }
}
