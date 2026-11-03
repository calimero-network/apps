import Foundation
import MeroKit

extension MeroAppBackend {
    /// The generated client over this backend's contract, bound to one scene.
    /// The client is generated with `--transport-import MeroKit`, so the SDK's
    /// bound contract is its transport as is.
    public func modelsClient(_ contextId: String) -> ModelsClient {
        ModelsClient(transport: contract.bound(to: contextId))
    }
}

/// Mesh and texture bytes, stored as blobs of the scene's app instance. The
/// app reads them with `MeroAppBackend.getBlob(blobId:contextId:)`
/// (`/apps/{app}/blobs` on the node).
public protocol BlobLoading: Sendable {
    func blob(id: String, contextId: String) async throws -> Data
}

/// No blobs: meshes stay as placeholder boxes.
public struct NoBlobs: BlobLoading {
    public init() {}
    public func blob(id: String, contextId: String) async throws -> Data {
        throw URLError(.resourceUnavailable)
    }
}
