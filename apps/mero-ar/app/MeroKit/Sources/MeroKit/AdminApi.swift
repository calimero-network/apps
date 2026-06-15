import Foundation

/// REST helper for the node's `/admin-api` surface (applications, namespaces,
/// contexts, identities, …). Mirrors web `rpc.ts` admin helpers.
public final class AdminApi {
    private let store: TokenStore
    private let session: URLSession

    public init(store: TokenStore, session: URLSession = .shared) {
        self.store = store
        self.session = session
    }

    public func get<T: Decodable>(_ path: String, as type: T.Type = T.self) async throws -> T {
        try await send("GET", path, body: nil, contentType: nil)
    }

    public func post<T: Decodable>(_ path: String, body: Encodable, as type: T.Type = T.self) async throws -> T {
        try await send("POST", path, body: try JSONEncoder().encode(AnyEncodable(body)), contentType: "application/json")
    }

    public func put<T: Decodable>(_ path: String, body: Encodable, as type: T.Type = T.self) async throws -> T {
        try await send("PUT", path, body: try JSONEncoder().encode(AnyEncodable(body)), contentType: "application/json")
    }

    /// NOTE: core requires `Content-Type: application/json` + an empty `{}` body
    /// on DELETE or it 400s — replicated here.
    public func delete<T: Decodable>(_ path: String, as type: T.Type = T.self) async throws -> T {
        try await send("DELETE", path, body: Data("{}".utf8), contentType: "application/json")
    }

    private func send<T: Decodable>(_ method: String, _ path: String, body: Data?, contentType: String?) async throws -> T {
        guard let nodeUrl = store.nodeUrl, let url = URL(string: "\(trim(nodeUrl))/admin-api\(path)") else {
            throw MeroError.notConfigured
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let token = store.accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        request.httpBody = body

        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw MeroError.transport(error.localizedDescription)
        }
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw MeroError.http(status: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        // admin-api wraps payloads as { data: ... } — unwrap if present, else decode whole.
        if let envelope = try? JSONDecoder().decode(DataEnvelope<T>.self, from: data), let inner = envelope.data {
            return inner
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw MeroError.decoding("\(error)")
        }
    }

    private struct DataEnvelope<T: Decodable>: Decodable { let data: T? }

    private func trim(_ s: String) -> String {
        var t = s; while t.hasSuffix("/") { t.removeLast() }; return t
    }
}

/// Type-erasing wrapper so `Encodable` existentials can be encoded.
struct AnyEncodable: Encodable {
    private let encodeFn: (Encoder) throws -> Void
    init(_ wrapped: Encodable) { self.encodeFn = wrapped.encode }
    func encode(to encoder: Encoder) throws { try encodeFn(encoder) }
}
