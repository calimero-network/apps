import Foundation

/// Upload/download large binary payloads (ARWorldMap, mesh, images) via the
/// node's blob store. Mirrors web `rpc.ts:adminUploadBlob/adminGetBlob`.
///
/// Pass `contextId` on upload so the node announces the blob to the network and
/// peers can fetch it immediately.
public final class BlobApi {
    private let store: TokenStore
    private let session: URLSession

    public init(store: TokenStore, session: URLSession = .shared) {
        self.store = store
        self.session = session
    }

    /// PUT raw bytes → returns the new blob id.
    public func upload(_ data: Data, contextId: String? = nil) async throws -> String {
        guard let nodeUrl = store.nodeUrl else { throw MeroError.notConfigured }
        var urlString = "\(trim(nodeUrl))/admin-api/blobs"
        if let contextId {
            urlString += "?context_id=\(contextId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? contextId)"
        }
        guard let url = URL(string: urlString) else { throw MeroError.notConfigured }

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        if let token = store.accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (respData, response): (Data, URLResponse)
        do {
            (respData, response) = try await session.upload(for: request, from: data)
        } catch {
            throw MeroError.transport(error.localizedDescription)
        }
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw MeroError.http(status: http.statusCode, body: String(data: respData, encoding: .utf8) ?? "")
        }
        // Response: { data: { blob_id | blobId, size } } — field is snake_case blob_id.
        let top = (try? JSONSerialization.jsonObject(with: respData)) as? [String: Any]
        let inner = top?["data"] as? [String: Any]
        if let id = (inner?["blob_id"] as? String) ?? (inner?["blobId"] as? String) {
            return id
        }
        throw MeroError.decoding("blob upload returned no blob id")
    }

    /// GET a blob's bytes.
    public func download(_ blobId: String) async throws -> Data {
        guard let nodeUrl = store.nodeUrl,
              let url = URL(string: "\(trim(nodeUrl))/admin-api/blobs/\(blobId)") else {
            throw MeroError.notConfigured
        }
        var request = URLRequest(url: url)
        if let token = store.accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw MeroError.transport(error.localizedDescription)
        }
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw MeroError.http(status: http.statusCode, body: "blob download failed")
        }
        return data
    }

    private func trim(_ s: String) -> String {
        var t = s; while t.hasSuffix("/") { t.removeLast() }; return t
    }
}
