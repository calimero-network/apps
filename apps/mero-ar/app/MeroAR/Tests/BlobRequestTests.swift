import XCTest
import MeroKit
@testable import MeroAR

/// The world map is the one thing in this app that travels as a blob, and since
/// core#3823 (0.11.0-rc.39) a blob request without `context_id` is not an error
/// — it is a perfectly well-formed request that reaches nobody. The DHT that
/// used to find a blob by id alone is gone; the context is the only index left.
///
/// That makes it invisible from the publisher's own device, which holds the
/// bytes locally and relocalizes fine either way, and fatal on every other
/// device in the room. Nothing but reading the URL shows it, so these pin the
/// URL.
final class BlobRequestTests: XCTestCase {
    private let context = "b0b7e7de6b4e4d0d9ad4f1e39c2a5c7f3e1d0a9b8c7d6e5f4a3b2c1d0e9f8a7b"
    private let blob = "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0"

    private func makeService() -> MeroARService {
        MeroARService(
            mero: Mero(config: MeroConfig(baseURL: URL(string: "http://localhost:2450")!)),
            contextId: context,
            memberId: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        )
    }

    func testUploadCarriesTheContextId() {
        XCTAssertEqual(makeService().blobUploadPath, "/admin-api/blobs?context_id=\(context)")
    }

    func testDownloadCarriesTheContextId() {
        XCTAssertEqual(
            makeService().blobDownloadPath(blob),
            "/admin-api/blobs/\(blob)?context_id=\(context)")
    }

    /// A blob id is hex since core#3691 (0.11.0-rc.27) removed base58, and it is
    /// stored on the contract exactly as the node minted it. Re-encoding it —
    /// base58, uppercase, anything — writes one id and reads another, which
    /// surfaces later as three unrelated-looking bugs. The id must appear in the
    /// path verbatim.
    func testBlobIdIsNotReEncoded() {
        XCTAssertTrue(makeService().blobDownloadPath(blob).contains(blob))
    }

    /// Core answers an upload with the `{ data: { blob_id, size } }` envelope —
    /// snake_case inside, camelCase nowhere. Decoding `blobId` off it would
    /// yield nil and point the room at an empty world map.
    func testUploadResponseDecodesSnakeCase() throws {
        let json = Data(#"{"data":{"blob_id":"\#(blob)","size":4096}}"#.utf8)
        let envelope = try MeroJSON.decode(
            ApiResponse<MeroARService.BlobRef>.self, from: json)
        XCTAssertEqual(envelope.data?.blobId, blob)
        XCTAssertEqual(envelope.data?.size, 4096)
    }
}
