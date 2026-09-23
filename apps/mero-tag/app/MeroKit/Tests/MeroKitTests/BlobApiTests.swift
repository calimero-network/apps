import XCTest
@testable import MeroKit

final class BlobApiTests: XCTestCase {
    private var api: BlobApi!
    private var store: InMemoryTokenStore!

    override func setUp() {
        super.setUp()
        store = InMemoryTokenStore(nodeUrl: "http://node.test", accessToken: "tok")
        api = BlobApi(store: store, session: MockURLProtocol.makeSession())
    }
    override func tearDown() { MockURLProtocol.handler = nil; super.tearDown() }

    func testUploadReturnsBlobIdSnakeCase() async throws {
        MockURLProtocol.handler = { MockURLProtocol.ok($0, #"{"data":{"blob_id":"b-123","size":42}}"#) }
        let id = try await api.upload(Data("hello".utf8))
        XCTAssertEqual(id, "b-123")
    }

    func testUploadReturnsBlobIdCamelCase() async throws {
        MockURLProtocol.handler = { MockURLProtocol.ok($0, #"{"data":{"blobId":"b-456"}}"#) }
        let id = try await api.upload(Data("hi".utf8))
        XCTAssertEqual(id, "b-456")
    }

    func testUploadSendsOctetStreamAndContextQuery() async throws {
        let cap = Captured()
        MockURLProtocol.handler = { cap.record($0); return MockURLProtocol.ok($0, #"{"data":{"blob_id":"b"}}"#) }
        _ = try await api.upload(Data([1, 2, 3]), contextId: "ctx-1")
        XCTAssertEqual(cap.request?.httpMethod, "PUT")
        XCTAssertEqual(cap.contentType, "application/octet-stream")
        XCTAssertEqual(cap.auth, "Bearer tok")
        XCTAssertTrue(cap.request?.url?.query?.contains("context_id=ctx-1") ?? false)
    }

    func testDownloadReturnsBytes() async throws {
        let payload = Data([0xDE, 0xAD, 0xBE, 0xEF])
        MockURLProtocol.handler = { req in
            let resp = HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (resp, payload)
        }
        let data = try await api.download("b-789")
        XCTAssertEqual(data, payload)
    }

    /// rc.39 removed the blob DHT: `?context_id=` is the only way to find a
    /// blob. `download` did not send one at all, so a blob written on any other
    /// node could never be fetched — it read as "not found", not as a missing
    /// parameter.
    func testDownloadSendsContextQuery() async throws {
        let cap = Captured()
        MockURLProtocol.handler = { cap.record($0); return MockURLProtocol.ok($0, "") }
        _ = try await api.download("deadbeef", contextId: "ctx-1")
        XCTAssertEqual(cap.request?.url?.path, "/admin-api/blobs/deadbeef")
        XCTAssertTrue(cap.request?.url?.query?.contains("context_id=ctx-1") ?? false)
        XCTAssertEqual(cap.auth, "Bearer tok")
    }

    /// A local read-back is legitimate, so the parameter stays optional — but
    /// then nothing is appended, rather than an empty one being sent.
    func testDownloadWithoutContextHasNoQuery() async throws {
        let cap = Captured()
        MockURLProtocol.handler = { cap.record($0); return MockURLProtocol.ok($0, "") }
        _ = try await api.download("deadbeef")
        XCTAssertNil(cap.request?.url?.query)
    }

    /// A blob id is 64 hex characters since rc.27 removed base58. It is passed
    /// through verbatim — re-encoding one is a write-then-read failure that
    /// reads like three unrelated bugs.
    func testBlobIdIsUsedVerbatim() async throws {
        let cap = Captured()
        let hexId = String(repeating: "ab", count: 32)
        MockURLProtocol.handler = { cap.record($0); return MockURLProtocol.ok($0, "") }
        _ = try await api.download(hexId, contextId: "ctx")
        XCTAssertEqual(cap.request?.url?.path, "/admin-api/blobs/\(hexId)")
    }

    /// Under ~30 seconds the client aborts the peer sweep that rc.39 made the
    /// only discovery path, and a blob that would have arrived reads as absent.
    func testTransferTimeoutOutlastsThePeerSweep() async throws {
        let cap = Captured()
        MockURLProtocol.handler = { cap.record($0); return MockURLProtocol.ok($0, "") }
        _ = try await api.download("b", contextId: "ctx")
        XCTAssertGreaterThan(cap.request?.timeoutInterval ?? 0, 30)
    }

    func testUploadMissingIdThrows() async {
        MockURLProtocol.handler = { MockURLProtocol.ok($0, #"{"data":{}}"#) }
        do { _ = try await api.upload(Data()); XCTFail("expected throw") }
        catch let e as MeroError { if case .decoding = e {} else { XCTFail("wrong: \(e)") } }
        catch { XCTFail("wrong type: \(error)") }
    }
}
