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
/// URL — now on the relay's Bearer session.
final class BlobRequestTests: XCTestCase {
    private let context = "b0b7e7de6b4e4d0d9ad4f1e39c2a5c7f3e1d0a9b8c7d6e5f4a3b2c1d0e9f8a7b"
    private let blob = "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0"

    override func setUp() {
        super.setUp()
        RelayStub.reset()
    }

    func testUploadPathCarriesTheContextId() {
        XCTAssertEqual(
            Fixture.service(context: context).blobUploadPath, "/admin-api/blobs?context_id=\(context)")
    }

    func testUploadSendsRawBytesToTheRoomsBlobSpace() async throws {
        RelayStub.on("PUT", "/admin-api/blobs", json: #"{"data":{"blob_id":"\#(blob)","size":3}}"#)

        let id = try await Fixture.service(context: context).uploadWorldMap(Data([1, 2, 3]))

        XCTAssertEqual(id, blob)
        let request = try XCTUnwrap(RelayStub.requests.first)
        XCTAssertEqual(request.method, "PUT")
        XCTAssertEqual(request.query, "context_id=\(context)")
    }

    /// The download goes through the SDK blob API, which must still name the
    /// room — and must use the hex id verbatim (core#3691 removed base58).
    func testDownloadCarriesTheContextIdAndTheIdVerbatim() async throws {
        RelayStub.on("GET", "/admin-api/blobs/\(blob)", json: "{}")

        _ = try await Fixture.service(context: context).downloadWorldMap(blobId: blob)

        let request = try XCTUnwrap(RelayStub.requests.first)
        XCTAssertEqual(request.path, "/admin-api/blobs/\(blob)")
        XCTAssertEqual(request.query, "context_id=\(context)")
    }

    /// Without the relay's Bearer session there is nowhere to put a blob; say
    /// so rather than failing with a transport error.
    func testBlobsNeedTheBearerSession() async {
        do {
            _ = try await Fixture.service(context: context, withBearer: false).downloadWorldMap(blobId: blob)
            XCTFail("downloaded without a session")
        } catch {
            XCTAssertEqual(error as? MeroARError, .readsUnavailable)
        }
    }

    /// Core answers an upload with the `{ data: { blob_id, size } }` envelope —
    /// snake_case inside, camelCase nowhere.
    func testUploadResponseDecodesSnakeCase() throws {
        let json = Data(#"{"data":{"blob_id":"\#(blob)","size":4096}}"#.utf8)
        let envelope = try MeroJSON.decode(ApiResponse<MeroARService.BlobRef>.self, from: json)
        XCTAssertEqual(envelope.data?.blobId, blob)
        XCTAssertEqual(envelope.data?.size, 4096)
    }
}
