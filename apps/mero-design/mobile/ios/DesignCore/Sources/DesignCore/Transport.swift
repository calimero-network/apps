import Foundation
import MeroKit

// The board's contract is `DesignClient`, generated from the component ABI by core's
// `mero-app-build codegen` (`scripts/mobile-codegen.sh`): camelCase methods and arguments, 64-bit
// integers as decimal strings. `getElements` answers at most 1,000 elements, so the board is read
// page by page through `getElementsPage` (`allElements()`), as the web app's
// `src/api/meroDesign.ts` does.

/// A board's contract client, for one app instance.
public typealias ClientFactory = @Sendable (_ contextId: String) -> DesignClient

extension MeroAppBackend {
    /// The generated client over this backend's contract, bound to the board's app instance.
    public func designClient(_ contextId: String) -> DesignClient {
        DesignClient(backend: self, app: contextId)
    }
}

extension DesignClient {
    /// Elements per `getElementsPage` read (the contract's largest page).
    public static let elementPage: UInt32 = 1_000

    /// Every element in paint order, read a page at a time.
    public func allElements() async throws -> [DesignCore.Element] {
        var items: [DesignCore.Element] = []
        var cursor: String?
        while true {
            let page = try await getElementsPage(cursor: cursor, limit: Self.elementPage)
            items += try (page["items"]?.arrayValue ?? []).map { try $0.decoded(as: DesignCore.Element.self) }
            guard let next = page["nextCursor"]?.stringValue, !next.isEmpty else { break }
            cursor = next
        }
        return items
    }
}

/// Image bytes stored as blobs on the board's app instance.
public protocol BlobLoading: Sendable {
    func blob(id: String, contextId: String) async throws -> Data
}

/// Blobs through the signed-in backend: on Calimero 1.0, `GET /apps/{app}/blobs/{id}`.
public struct BackendBlobs: BlobLoading {
    public let backend: any MeroAppBackend

    public init(backend: any MeroAppBackend) {
        self.backend = backend
    }

    public func blob(id: String, contextId: String) async throws -> Data {
        try await backend.getBlob(blobId: id, contextId: contextId)
    }
}

/// No blobs: images are drawn as placeholders.
public struct NoBlobs: BlobLoading {
    public init() {}
    public func blob(id: String, contextId: String) async throws -> Data {
        throw URLError(.resourceUnavailable)
    }
}
