import Foundation
import MeroKit

// The generated client declares its own `ContextContractCalling` (JSON in,
// JSON out), with the same two requirements as MeroKit's. The SDK's bound
// contract already has both methods, so it conforms as is.
extension BoundContextContract: ContextContractCalling {}

/// A board's contract client, for one context.
public typealias ClientFactory = @Sendable (_ contextId: String) -> DesignClient

extension MeroAppBackend {
    /// The generated client over this backend's contract, bound to `contextId`.
    public func designClient(_ contextId: String) -> DesignClient {
        DesignClient(transport: contract.bound(to: contextId))
    }
}

/// Image bytes stored as blobs on the board's context. `MeroAppBackend` has no
/// blob call yet, so the app reads them through the signed-in client's admin
/// surface (`getBlob(_:contextId:)`, which the account's relay serves).
public protocol BlobLoading: Sendable {
    func blob(id: String, contextId: String) async throws -> Data
}

/// No blobs: images are drawn as placeholders.
public struct NoBlobs: BlobLoading {
    public init() {}
    public func blob(id: String, contextId: String) async throws -> Data {
        throw URLError(.resourceUnavailable)
    }
}
