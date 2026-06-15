import Foundation

/// JSON-RPC `execute` client — the Swift equivalent of web `rpc.ts:rpcCall`.
/// POSTs `{jsonrpc, id, method:"execute", params:{contextId, method, argsJson}}`
/// to `{nodeUrl}/jsonrpc` with a Bearer token, then normalises the output.
public final class RpcClient {
    private let store: TokenStore
    private let session: URLSession

    /// Called when a non-auth request returns 401 (token expired/revoked).
    public var onUnauthorized: (() -> Void)?

    public init(store: TokenStore, session: URLSession = .shared) {
        self.store = store
        self.session = session
    }

    private struct Request<A: Encodable>: Encodable {
        let jsonrpc = "2.0"
        let id = 1
        let method = "execute"
        let params: Params<A>
        struct Params<P: Encodable>: Encodable {
            let contextId: String
            let method: String
            let argsJson: P
        }
    }

    /// Encodable used for no-argument methods.
    public struct NoArgs: Encodable { public init() {} }

    /// Execute a contract method and decode the result into `T`.
    public func execute<A: Encodable, T: Decodable>(
        contextId: String,
        method: String,
        args: A,
        as type: T.Type = T.self
    ) async throws -> T {
        guard let data = try await executeRaw(contextId: contextId, method: method, args: args) else {
            throw MeroError.emptyResult
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw MeroError.decoding("\(error) — payload: \(String(data: data, encoding: .utf8) ?? "<binary>")")
        }
    }

    /// Execute a method whose return value is not needed (e.g. mutations).
    public func executeVoid<A: Encodable>(
        contextId: String,
        method: String,
        args: A
    ) async throws {
        _ = try await executeRaw(contextId: contextId, method: method, args: args)
    }

    /// Execute and return the normalised JSON `Data` (or nil for empty result).
    public func executeRaw<A: Encodable>(
        contextId: String,
        method: String,
        args: A
    ) async throws -> Data? {
        guard let nodeUrl = store.nodeUrl, let url = URL(string: "\(trim(nodeUrl))/jsonrpc") else {
            throw MeroError.notConfigured
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = store.accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let body = Request(params: .init(contextId: contextId, method: method, argsJson: args))
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw MeroError.transport(error.localizedDescription)
        }

        if let http = response as? HTTPURLResponse {
            if http.statusCode == 401 { onUnauthorized?() }
            guard (200..<300).contains(http.statusCode) else {
                throw MeroError.http(status: http.statusCode,
                                     body: String(data: data, encoding: .utf8) ?? "")
            }
        }

        let top = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        if let error = top?["error"] {
            throw MeroError.fromRpcError(error)
        }
        let result = top?["result"] as? [String: Any]
        // execute returns { output, logs } — older nodes nest differently.
        let output = result?["output"] ?? result?["data"] ?? top?["data"]
        return try OutputParser.normalize(output)
    }

    private func trim(_ s: String) -> String {
        var t = s
        while t.hasSuffix("/") { t.removeLast() }
        return t
    }
}
