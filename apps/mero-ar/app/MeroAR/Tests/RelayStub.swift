import Foundation
import MeroKit
@testable import MeroAR

/// A recorded request, with its body read back out of the stream URLSession
/// hands a protocol.
struct RecordedRequest {
    let method: String
    let url: URL
    let headers: [String: String]
    let body: JSONValue?

    var path: String { url.path }
    var query: String? { url.query }
}

/// Answers every request from a table of `(method, path) → (status, body)`,
/// and records what was sent. One relay at a time; `reset()` between tests.
final class RelayStub: URLProtocol {
    typealias Reply = (status: Int, body: Data)

    nonisolated(unsafe) private static var routes: [String: Reply] = [:]
    nonisolated(unsafe) private static var recorded: [RecordedRequest] = []
    private static let lock = NSLock()

    static func reset() {
        lock.lock()
        routes = [:]
        recorded = []
        lock.unlock()
    }

    static func on(_ method: String, _ path: String, status: Int = 200, json: String) {
        lock.lock()
        routes["\(method) \(path)"] = (status, Data(json.utf8))
        lock.unlock()
    }

    static var requests: [RecordedRequest] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    static var session: URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RelayStub.self]
        return URLSession(configuration: config)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let method = request.httpMethod ?? "GET"
        let url = request.url!
        var data = request.httpBody
        if data == nil, let stream = request.httpBodyStream {
            stream.open()
            var buffer = Data()
            var chunk = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let read = stream.read(&chunk, maxLength: chunk.count)
                if read <= 0 { break }
                buffer.append(chunk, count: read)
            }
            stream.close()
            data = buffer
        }
        let body = data.flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }
        Self.lock.lock()
        Self.recorded.append(
            RecordedRequest(method: method, url: url, headers: request.allHTTPHeaderFields ?? [:], body: body))
        let reply = Self.routes["\(method) \(url.path)"] ?? (404, Data(#"{"error":"no stub"}"#.utf8))
        Self.lock.unlock()

        let response = HTTPURLResponse(
            url: url, statusCode: reply.status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: reply.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

enum Fixture {
    static let relayURL = "https://relay.test"
    static let account = String(repeating: "ab", count: 32)
    static let executor = String(repeating: "cd", count: 32)
    static let executorKey = String(repeating: "ef", count: 32)
    static let bytecode = String(repeating: "12", count: 32)

    /// A context id (64 hex, as a warrant requires) unique to the calling
    /// test: the SDK remembers per `relay|context|method` whether a method is a
    /// view, so tests must not share one.
    static func context() -> String {
        (0..<32).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }

    static func relay() -> RelayClient {
        RelayClient(
            relayURL: relayURL, authorAccount: account, authorProof: "00", keys: DeviceKeys.generate(),
            nonces: MemoryWarrantNonceStore(), tokenProvider: { "bearer-token" }, session: RelayStub.session,
            rateLimitRetries: 0)
    }

    static func mero() -> Mero {
        Mero(config: MeroConfig(baseURL: URL(string: relayURL)!), session: RelayStub.session)
    }

    static func service(context: String, withBearer: Bool = true) -> MeroARService {
        MeroARService(
            relay: relay(), mero: withBearer ? mero() : nil, contextId: context, memberId: account)
    }

    /// `GET …/intents` — what the relay says about executing in `context`.
    static func stubDescribe(_ context: String) {
        RelayStub.on(
            "GET", "/admin-api/contexts/\(context)/intents",
            json: """
                {"data":{"executorAccount":"\(executor)","executorKey":"\(executorKey)",
                "canAuthorOnBehalf":true,"groupId":"\(String(repeating: "00", count: 32))",
                "releaseBytecodeId":"\(bytecode)","releaseVersion":"0.0.1"}}
                """)
    }
}
