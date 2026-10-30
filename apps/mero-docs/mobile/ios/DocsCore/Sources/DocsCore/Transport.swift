import Foundation
import MeroKit

/// One folder's docs contract: the generated client, plus the raw transport for
/// the one read the generated decoder cannot take (see ``DocsAPI/readDocument(_:)``).
public struct DocsAPI: Sendable {
    public let client: DocsClient
    let transport: any ContextContractCalling

    public init(transport: any ContextContractCalling) {
        self.transport = transport
        self.client = DocsClient(transport: transport)
    }

    /// The document's body as blocks, in order.
    ///
    /// `get_document` is called through the transport and decoded leniently
    /// rather than with the generated `getDocument`: the node writes a span's
    /// `"true"` marks back as JSON booleans and leaves `attributes` out of a
    /// plain span, which the ABI's `map<string,string>` does not describe, so
    /// the generated decoder would refuse every formatted document.
    public func readDocument(_ docId: String) async throws -> [WireBlock] {
        let args = try JSONEncoder().encode(["doc": docId])
        let data = try await transport.query(method: "get_document", argsJSON: args)
        return try JSONDecoder().decode([WireBlock].self, from: data)
    }
}

/// A folder's docs client, for one context.
public typealias DocsFactory = @Sendable (_ contextId: String) -> DocsAPI

extension MeroAppBackend {
    /// The docs contract over this backend's contract, bound to `contextId`.
    public func docs(_ contextId: String) -> DocsAPI {
        DocsAPI(transport: contract.bound(to: contextId))
    }
}

/// Image bytes stored as blobs on the folder's docs app instance, read through
/// `MeroAppBackend.getBlob` (`/apps/{app}/blobs` on Calimero 1.0).
public protocol BlobLoading: Sendable {
    func blob(id: String, contextId: String) async throws -> Data
}

/// No blobs: images show as unavailable.
public struct NoBlobs: BlobLoading {
    public init() {}
    public func blob(id: String, contextId: String) async throws -> Data {
        throw URLError(.resourceUnavailable)
    }
}
