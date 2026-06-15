import Foundation
@testable import MeroKit

/// URLProtocol stub so we can exercise the networking layer (request build →
/// response parse → decode) without a live node. Shared by all test files.
final class MockURLProtocol: URLProtocol {
    /// Returns (response, body) for a given request. Inspect `request` to branch
    /// on URL/method and to capture what the client sent.
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let handler = MockURLProtocol.handler else {
            client?.urlProtocol(self, didFailWithError: MeroError.transport("no handler"))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }
    override func stopLoading() {}

    /// A URLSession wired to this protocol.
    static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return URLSession(configuration: config)
    }

    static func ok(_ request: URLRequest, _ json: String, status: Int = 200) -> (HTTPURLResponse, Data) {
        let resp = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        return (resp, Data(json.utf8))
    }
}

extension URLRequest {
    /// URLProtocol moves the body into a stream — read it back for assertions.
    var bodyData: Data? {
        if let httpBody { return httpBody }
        guard let stream = httpBodyStream else { return nil }
        stream.open(); defer { stream.close() }
        var data = Data(); let size = 4096; var buf = [UInt8](repeating: 0, count: size)
        while stream.hasBytesAvailable {
            let read = stream.read(&buf, maxLength: size)
            if read <= 0 { break }
            data.append(buf, count: read)
        }
        return data
    }
}

/// Thread-safe capture box for assertions made inside the mock handler.
final class Captured: @unchecked Sendable {
    var request: URLRequest?
    var auth: String?
    var contentType: String?
    var body: Data?
    func record(_ req: URLRequest) {
        request = req
        auth = req.value(forHTTPHeaderField: "Authorization")
        contentType = req.value(forHTTPHeaderField: "Content-Type")
        body = req.bodyData
    }
}
