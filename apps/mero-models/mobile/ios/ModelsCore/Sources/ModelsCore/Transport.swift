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

/// Mesh and texture bytes, stored as blobs on the scene's context.
/// `MeroAppBackend` has no blob call yet, so the app reads them through the
/// signed-in client's admin surface (`getBlob(_:contextId:)`, which the
/// account's relay serves).
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
