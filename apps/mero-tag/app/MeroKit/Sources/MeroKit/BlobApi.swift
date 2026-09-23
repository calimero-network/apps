import Foundation

/// Upload/download large binary payloads via the node's blob store.
///
/// ## `contextId` is not optional in practice
///
/// core 0.11.0-rc.39 removed the blob DHT. `?context_id=` is now the **only**
/// discovery path there is:
///
/// - an upload without one is announced to nobody, so no peer can ever fetch it;
/// - a download without one asks the local store and stops — it never sweeps
///   peers, so a blob another member wrote reads as "not found" forever.
///
/// The parameter stays optional in the signature because a node may legitimately
/// read back a blob it wrote itself, but any blob that crosses a node needs it on
/// BOTH calls. `download` took no context id at all before this, which is the
/// half that silently could not work.
///
/// ## Ids are hex
///
/// A blob id has been 64 hex characters since rc.27, when base58 was removed
/// everywhere. Re-encoding one before storing it produces a write-then-read
/// failure that reads like three unrelated bugs, so ids are passed through
/// verbatim and never transformed.
///
/// ## Timeouts
///
/// A download that has to sweep peers takes longer than a request against local
/// state, and a client timeout under ~30 seconds aborts the sweep — which
/// surfaces as a missing blob rather than as a timeout. Both calls therefore set
/// their own generous `timeoutInterval` instead of inheriting URLSession's
/// 60-second default, which on a phone on cellular is not enough headroom.
public final class BlobApi {
    private let store: TokenStore
    private let transport: AuthorizedTransport

    /// Long enough for the peer sweep rc.39 made the only discovery path, and
    /// for a large body over a slow mobile link.
    public static let transferTimeout: TimeInterval = 120

    public init(store: TokenStore, session: URLSession = .shared, authority: SessionAuthority? = nil) {
        self.store = store
        self.transport = AuthorizedTransport(
            session: session,
            authority: authority ?? SessionAuthority(store: store, session: session))
    }

    /// PUT raw bytes → returns the new blob id.
    ///
    /// Pass `contextId` for anything another member must be able to read.
    public func upload(_ data: Data, contextId: String? = nil) async throws -> String {
        guard let nodeUrl = store.nodeUrl,
              let url = blobsURL(base: nodeUrl, path: "/admin-api/blobs", contextId: contextId)
        else { throw MeroError.notConfigured }

        let (respData, http) = try await transport.send { token in
            var request = URLRequest(url: url)
            request.httpMethod = "PUT"
            request.timeoutInterval = Self.transferTimeout
            request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
            request.httpBody = data
            return request
        }
        try ensureSuccess(http, respData)

        // Response: { data: { blob_id | blobId, size } } — field is snake_case blob_id.
        let top = (try? JSONSerialization.jsonObject(with: respData)) as? [String: Any]
        let inner = top?["data"] as? [String: Any]
        if let id = (inner?["blob_id"] as? String) ?? (inner?["blobId"] as? String) {
            return id
        }
        throw MeroError.decoding("blob upload returned no blob id")
    }

    /// GET a blob's bytes.
    ///
    /// `contextId` names where to look. Without it the node answers from its own
    /// store only — since rc.39 there is no DHT to fall back on — so a blob
    /// written by a peer is simply never found.
    public func download(_ blobId: String, contextId: String? = nil) async throws -> Data {
        guard let nodeUrl = store.nodeUrl,
              let url = blobsURL(base: nodeUrl, path: "/admin-api/blobs/\(blobId)", contextId: contextId)
        else { throw MeroError.notConfigured }

        let (data, http) = try await transport.send { token in
            var request = URLRequest(url: url)
            request.timeoutInterval = Self.transferTimeout
            if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
            return request
        }
        try ensureSuccess(http, data, fallbackBody: "blob download failed")
        return data
    }

    private func blobsURL(base: String, path: String, contextId: String?) -> URL? {
        var components = URLComponents(string: trim(base) + path)
        if let contextId, !contextId.isEmpty {
            components?.queryItems = [URLQueryItem(name: "context_id", value: contextId)]
        }
        return components?.url
    }

    private func trim(_ s: String) -> String {
        var t = s; while t.hasSuffix("/") { t.removeLast() }; return t
    }
}
