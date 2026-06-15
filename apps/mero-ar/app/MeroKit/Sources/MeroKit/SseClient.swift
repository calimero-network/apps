import Foundation

/// A live context event delivered to the app.
public struct MeroEvent: Sendable {
    public let contextId: String
    /// Normalised JSON payload of the event (decode into your event enum).
    public let data: Data
}

/// Streaming SSE client — the Swift equivalent of web `sse.ts:SseClient`.
/// Connects to `GET {nodeUrl}/sse`, handles the `connect` handshake, POSTs a
/// subscription for the requested contexts, and yields matching events. It
/// auto-reconnects with a fixed delay until the consuming task is cancelled.
public final class SseClient: @unchecked Sendable {
    private let store: TokenStore
    private let session: URLSession
    private let reconnectDelay: Duration

    public init(store: TokenStore, session: URLSession = .shared, reconnectDelayMs: Int = 8000) {
        self.store = store
        self.session = session
        self.reconnectDelay = .milliseconds(reconnectDelayMs)
    }

    /// Stream events for the given context ids. Cancelling the iterating task
    /// (or the surrounding `Task`) tears down the connection.
    public func events(contexts: Set<String>) -> AsyncStream<MeroEvent> {
        AsyncStream { continuation in
            let task = Task { [weak self] in
                guard let self else { return }
                while !Task.isCancelled {
                    do {
                        try await self.runOnce(contexts: contexts, continuation: continuation)
                    } catch {
                        if Task.isCancelled { break }
                    }
                    if Task.isCancelled { break }
                    try? await Task.sleep(for: self.reconnectDelay)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func runOnce(contexts: Set<String>, continuation: AsyncStream<MeroEvent>.Continuation) async throws {
        guard let nodeUrl = store.nodeUrl, let url = URL(string: "\(trim(nodeUrl))/sse") else {
            throw MeroError.notConfigured
        }
        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        if let token = store.accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (bytes, response) = try await session.bytes(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw MeroError.http(status: http.statusCode, body: "SSE connect failed")
        }

        for try await line in bytes.lines {
            if Task.isCancelled { return }
            guard line.hasPrefix("data:") else { continue }
            let payload = String(line.dropFirst(5))
            switch SseMessageDecoder.decode(payload) {
            case .connect(let sessionId):
                try? await subscribe(sessionId: sessionId, contexts: Array(contexts))
            case .event(let contextId, let data):
                if contexts.contains(contextId) {
                    continuation.yield(MeroEvent(contextId: contextId, data: data))
                }
            case .ignored:
                break
            }
        }
    }

    private struct SubscriptionBody: Encodable {
        let id: String
        let method: String
        let params: Params
        struct Params: Encodable { let contextIds: [String] }
    }

    private func subscribe(sessionId: String, contexts: [String]) async throws {
        guard !contexts.isEmpty,
              let nodeUrl = store.nodeUrl,
              let url = URL(string: "\(trim(nodeUrl))/sse/subscription") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = store.accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONEncoder().encode(
            SubscriptionBody(id: sessionId, method: "subscribe", params: .init(contextIds: contexts))
        )
        _ = try? await session.data(for: request)
    }

    private func trim(_ s: String) -> String {
        var t = s; while t.hasSuffix("/") { t.removeLast() }; return t
    }
}
