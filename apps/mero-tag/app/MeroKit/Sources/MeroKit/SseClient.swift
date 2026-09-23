import Foundation

/// A live context event delivered to the app.
public struct MeroEvent: Sendable {
    public let contextId: String
    /// Normalised JSON payload of the event (decode into your event enum).
    public let data: Data
}

/// Streaming SSE client. Connects to `GET {nodeUrl}/sse`, handles the `connect`
/// handshake, POSTs a subscription for the requested contexts, and yields
/// matching events.
///
/// ## What the reconnect loop must not do
///
/// It used to reconnect on a fixed delay, forever, whatever the node said. Three
/// responses make that wrong:
///
/// 1. **403 `token_revoked`.** Core answers a revoked token family with a *403*
///    and an empty body — never a 401. Retrying re-sends a credential that has
///    been destroyed, so the loop runs until the app is killed while the UI
///    shows a connected-looking screen that never updates.
/// 2. **403 `permission_denied`.** The token was minted without
///    `context:subscribe`. No amount of reconnecting mints a new one.
/// 3. **401 `token_expired`.** Recoverable, and the *only* recoverable one — but
///    it needs a refresh, not a retry, and it needs it immediately rather than
///    after the reconnect delay. Access tokens live one hour, so a tracker left
///    running hits this every hour.
///
/// So: terminal reasons stop the stream and report; expiry refreshes and
/// reconnects at once; everything else backs off exponentially with jitter
/// rather than hammering a node that is down at a fixed cadence.
public final class SseClient: @unchecked Sendable {
    private let store: TokenStore
    private let session: URLSession
    private let authority: SessionAuthority
    private let baseDelay: Duration
    private let maxDelay: Duration

    /// Reported when the stream stops for a reason the caller must act on —
    /// a dead session (`authRevoked`), or a subscribe the node silently
    /// narrowed (`notSubscribed`). Transient network failures are not reported;
    /// they are retried.
    public var onError: (@Sendable (MeroError) -> Void)?

    /// A live SSE connection is idle by design. Core sends a keep-alive comment
    /// every 15s, so this only has to outlast a lost one.
    private static let streamTimeout: TimeInterval = 120

    public init(
        store: TokenStore,
        session: URLSession = .shared,
        authority: SessionAuthority? = nil,
        reconnectDelayMs: Int = 2000,
        maxReconnectDelayMs: Int = 60_000
    ) {
        self.store = store
        self.session = session
        self.authority = authority ?? SessionAuthority(store: store, session: session)
        self.baseDelay = .milliseconds(reconnectDelayMs)
        self.maxDelay = .milliseconds(max(reconnectDelayMs, maxReconnectDelayMs))
    }

    /// Stream events for the given context ids. Cancelling the iterating task
    /// (or the surrounding `Task`) tears down the connection.
    public func events(contexts: Set<String>) -> AsyncStream<MeroEvent> {
        AsyncStream { continuation in
            let task = Task { [weak self] in
                guard let self else { return }
                var attempt = 0
                while !Task.isCancelled {
                    do {
                        try await self.runOnce(contexts: contexts, continuation: continuation)
                        attempt = 0  // a clean disconnect is not a failure
                    } catch let error as MeroError {
                        if Task.isCancelled { break }
                        switch error {
                        case .authRevoked, .notSubscribed:
                            // Nothing a retry can reach. Report and stop, so the
                            // app can send the user back to login instead of
                            // showing a screen that will never update again.
                            self.onError?(error)
                            continuation.finish()
                            return
                        default:
                            attempt += 1
                        }
                    } catch {
                        if Task.isCancelled { break }
                        attempt += 1
                    }
                    if Task.isCancelled { break }
                    try? await Task.sleep(for: self.backoff(attempt))
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Exponential, capped, and jittered. Without the jitter every client that
    /// lost the same node reconnects in lockstep.
    private func backoff(_ attempt: Int) -> Duration {
        guard attempt > 0 else { return baseDelay }
        let factor = 1 << min(attempt - 1, 10)
        let grown = baseDelay * factor
        let capped = grown > maxDelay ? maxDelay : grown
        let jitter = Double.random(in: 0.5...1.0)
        return capped * jitter
    }

    private func runOnce(contexts: Set<String>, continuation: AsyncStream<MeroEvent>.Continuation) async throws {
        guard let nodeUrl = store.nodeUrl, let url = URL(string: "\(trim(nodeUrl))/sse") else {
            throw MeroError.notConfigured
        }

        let (bytes, response) = try await connect(url: url)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw MeroError.http(status: http.statusCode, body: "SSE connect failed")
        }

        for try await line in bytes.lines {
            if Task.isCancelled { return }
            guard line.hasPrefix("data:") else { continue }
            let payload = String(line.dropFirst(5))
            switch SseMessageDecoder.decode(payload) {
            case .connect(let sessionId):
                try await subscribe(sessionId: sessionId, contexts: Array(contexts))
            case .event(let contextId, let data):
                if contexts.contains(contextId) {
                    continuation.yield(MeroEvent(contextId: contextId, data: data))
                }
            case .ignored:
                break
            }
        }
    }

    /// Open the stream, refreshing once if the token has expired.
    ///
    /// `URLSession.bytes` is used rather than the shared transport because the
    /// response body is the long-lived stream itself, but the auth rules are the
    /// same ones `AuthorizedTransport` applies to every other call.
    private func connect(url: URL) async throws -> (URLSession.AsyncBytes, URLResponse) {
        let (token, generation) = await authority.credential()
        let (bytes, response) = try await open(url: url, token: token)

        guard let http = response as? HTTPURLResponse, let failure = http.authFailure else {
            return (bytes, response)
        }
        // A refused stream carries no body worth reading; drain nothing and
        // decide on the reason alone.
        let refreshed = try await authority.recover(from: failure, generation: generation)
        let (retryBytes, retryResponse) = try await open(url: url, token: refreshed)
        if let retryHttp = retryResponse as? HTTPURLResponse, let again = retryHttp.authFailure {
            throw MeroError.authRevoked(again.isRefreshable ? .invalidToken : again)
        }
        return (retryBytes, retryResponse)
    }

    private func open(url: URL, token: String?) async throws -> (URLSession.AsyncBytes, URLResponse) {
        var request = URLRequest(url: url)
        request.timeoutInterval = Self.streamTimeout
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        do {
            return try await session.bytes(for: request)
        } catch {
            throw MeroError.transport(error.localizedDescription)
        }
    }

    private struct SubscriptionBody: Encodable {
        let id: String
        let method: String
        let params: Params
        /// `ContextIds` is `deny_unknown_fields` + camelCase on the node, so this
        /// is the exact shape — `contextIds`, nothing beside it.
        struct Params: Encodable { let contextIds: [String] }
    }

    /// POST the subscription and **check what came back**.
    ///
    /// The node does not refuse a context the caller may not observe. It drops
    /// it, subscribes to the rest, and answers `200 {"status":"subscribed",
    /// "contexts":[…]}` listing only what it actually took. Ignoring that body —
    /// which this did — is why an unobservable context presents as a stream that
    /// is merely quiet, indistinguishable from an idle one, for as long as the
    /// app runs.
    private func subscribe(sessionId: String, contexts: [String]) async throws {
        guard !contexts.isEmpty,
              let nodeUrl = store.nodeUrl,
              let url = URL(string: "\(trim(nodeUrl))/sse/subscription") else { return }

        let body = try JSONEncoder().encode(
            SubscriptionBody(id: sessionId, method: "subscribe", params: .init(contextIds: contexts)))

        let transport = AuthorizedTransport(session: session, authority: authority)
        let (data, http) = try await transport.send { token in
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
            request.httpBody = body
            return request
        }
        try ensureSuccess(http, data)

        // `{"result":{"status":"subscribed","contexts":[…],"groups":[…]}}`.
        // A body we cannot read is not evidence of a drop — older nodes answered
        // differently — so only an explicit, shorter list is treated as one.
        guard let top = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let result = top["result"] as? [String: Any],
              let accepted = result["contexts"] as? [String]
        else { return }

        let dropped = contexts.filter { !accepted.contains($0) }
        if !dropped.isEmpty { throw MeroError.notSubscribed(contexts: dropped) }
    }

    private func trim(_ s: String) -> String {
        var t = s; while t.hasSuffix("/") { t.removeLast() }; return t
    }
}
