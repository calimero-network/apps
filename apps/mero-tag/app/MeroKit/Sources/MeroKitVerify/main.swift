// No-Xcode smoke test for MeroKit's pure logic. Run with:
//   swift run merokit-verify
// Mirrors the assertions in the XCTest suite so the core transport logic can be
// validated with only Command Line Tools installed (full Xcode not required).

import Foundation
import MeroKit

var failures = 0
func check(_ name: String, _ cond: Bool) {
    if cond { print("  ✓ \(name)") } else { print("  ✗ \(name)"); failures += 1 }
}

struct Point: Codable, Equatable { let x: Int; let y: Int }
func decode<T: Decodable>(_ output: Any?, as: T.Type) -> T? {
    guard let data = try? OutputParser.normalize(output) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
}

print("OutputParser")
check("null → nil", (try? OutputParser.normalize(NSNull())) == nil)
check("empty array → nil", (try? OutputParser.normalize([Any]())) == nil)
check("byte array → JSON", decode(Array(#"{"x":1,"y":2}"#.utf8).map(Int.init), as: Point.self) == Point(x: 1, y: 2))
check("object → JSON", decode(["x": 3, "y": 4] as [String: Any], as: Point.self) == Point(x: 3, y: 4))
check("array of objects", decode([["x": 1, "y": 1], ["x": 2, "y": 2]] as [Any], as: [Point].self)?.count == 2)
check("string-json", decode(#"{"x":9,"y":8}"#, as: Point.self) == Point(x: 9, y: 8))
check("bare string", decode("hello", as: String.self) == "hello")
check("scalar number", decode(42, as: Int.self) == 42)

print("MeroError.fromRpcError")
check("string error", MeroError.fromRpcError("boom") == .rpc(message: "boom"))
check("prefers data", MeroError.fromRpcError(["message": "x", "data": "real reason"]) == .rpc(message: "real reason"))
check("falls back to message", MeroError.fromRpcError(["message": "x"]) == .rpc(message: "x"))
check("empty data ignored", MeroError.fromRpcError(["message": "x", "data": ""]) == .rpc(message: "x"))

print("SseMessageDecoder")
check("connect", SseMessageDecoder.decode(#"{"type":"connect","session_id":"s1"}"#) == .connect(sessionId: "s1"))
check("garbage ignored", SseMessageDecoder.decode("not json") == .ignored)
if case let .event(ctx, data) = SseMessageDecoder.decode(#"{"result":{"contextId":"c1","data":{"TrackerUpdated":"t1"}}}"#) {
    let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    check("event contextId", ctx == "c1")
    check("event payload", (obj?["TrackerUpdated"] as? String) == "t1")
} else { check("event decode", false) }

print("AuthFailure (the 403 that is not a 401)")
func classify(_ status: Int, _ reason: String?) -> AuthFailure? {
    var headers: [String: String] = [:]
    if let reason { headers["X-Auth-Error"] = reason }
    return HTTPURLResponse(url: URL(string: "http://n/sse")!, statusCode: status,
                           httpVersion: nil, headerFields: headers)?.authFailure
}
check("revoked is a 403", classify(403, "token_revoked") == .tokenRevoked)
check("revoked is terminal", AuthFailure.tokenRevoked.isTerminal && !AuthFailure.tokenRevoked.isRefreshable)
check("expired is the only refreshable one", AuthFailure.tokenExpired.isRefreshable)
check("reuse is a 401 and terminal", classify(401, "token_reuse") == .tokenReuse && AuthFailure.tokenReuse.isTerminal)
check("permission_denied is a 403", classify(403, "permission_denied") == .permissionDenied)
check("headerless 403 is terminal", classify(403, nil)?.isTerminal == true)
check("headerless 401 is refreshable", classify(401, nil)?.isRefreshable == true)
check("2xx is not an auth failure", classify(200, nil) == nil)

print("AuthApi grant set")
check("asks for context:subscribe", AuthApi.permissions.contains("context:subscribe"))
check("grant set is not empty", !AuthApi.permissions.isEmpty)

print("TokenStore")
let store = InMemoryTokenStore(nodeUrl: "http://x", accessToken: "tok")
check("reads token", store.accessToken == "tok")
store.clear()
check("clears", store.accessToken == nil && store.nodeUrl == nil)

print("")
if failures == 0 { print("✅ MeroKit verify: all checks passed") }
else { print("❌ MeroKit verify: \(failures) check(s) failed"); exit(1) }
