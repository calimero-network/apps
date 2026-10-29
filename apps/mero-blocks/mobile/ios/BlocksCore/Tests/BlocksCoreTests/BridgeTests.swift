import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import BlocksCore

/// The page ↔ app message format. The page half is `game/src/bridge.ts`; Kotlin `BridgeTest`
/// pins the same shapes.
final class BridgeCodecTests: XCTestCase {
    func testDecodesACallWithItsArgumentsIntact() throws {
        let text = #"{"id":7,"op":"execute","method":"heartbeat","args":{"t":{"name":"Ana","x":12.5,"y":30,"z":-4.25,"yaw":1.571,"pitch":-0.2,"sel":3},"now":1730000000}}"#
        guard case .call(let id, let op, let method, let argsJSON) = try BridgeCodec.decode(text) else {
            return XCTFail("not a call")
        }
        XCTAssertEqual(id, 7)
        XCTAssertEqual(op, .execute)
        XCTAssertEqual(method, "heartbeat")
        let args = try XCTUnwrap(JSONSerialization.jsonObject(with: argsJSON) as? [String: Any])
        XCTAssertEqual((args["now"] as? NSNumber)?.int64Value, 1_730_000_000)
        let t = try XCTUnwrap(args["t"] as? [String: Any])
        XCTAssertEqual(t["x"] as? Double, 12.5)
        XCTAssertEqual(t["z"] as? Double, -4.25)
        XCTAssertEqual(t["name"] as? String, "Ana")
        XCTAssertTrue(String(decoding: argsJSON, as: UTF8.self).contains(#""now":1730000000"#), "an integer stays an integer")
    }

    func testAMissingArgsObjectIsEmpty() throws {
        guard case .call(_, let op, let method, let argsJSON) = try BridgeCodec.decode(#"{"id":1,"op":"query","method":"world_meta"}"#)
        else { return XCTFail("not a call") }
        XCTAssertEqual(op, .query)
        XCTAssertEqual(method, "world_meta")
        XCTAssertEqual(String(decoding: argsJSON, as: UTF8.self), "{}")
    }

    func testDecodesThePagesOneWayMessages() throws {
        XCTAssertEqual(try BridgeCodec.decode(#"{"op":"ready"}"#), .ready)
        XCTAssertEqual(try BridgeCodec.decode(#"{"op":"loaded"}"#), .loaded)
        XCTAssertEqual(try BridgeCodec.decode(#"{"op":"menu"}"#), .menu)
        XCTAssertEqual(try BridgeCodec.decode(#"{"op":"haptic","style":"selection"}"#), .haptic(style: "selection"))
        XCTAssertEqual(try BridgeCodec.decode(#"{"op":"fatal","message":"gone"}"#), .fatal(message: "gone"))
    }

    func testRefusesWhatIsNotAMessage() {
        for text in [
            "", "[]", "not json", #"{"id":1}"#, #"{"op":"teleport"}"#, #"{"op":"query","method":"get_players"}"#,
            #"{"id":1,"op":"query"}"#, #"{"id":1,"op":"query","method":"world_meta","args":[1,2]}"#,
        ] {
            XCTAssertThrowsError(try BridgeCodec.decode(text), text)
        }
    }

    func testEncodesAResultAroundTheContractsJSON() throws {
        let message = BridgeCodec.result(id: 3, json: Data(#"[{"k":"1,2,3","b":4}]"#.utf8))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(message.utf8)) as? [String: Any])
        XCTAssertEqual(object["type"] as? String, "result")
        XCTAssertEqual(object["id"] as? Int, 3)
        XCTAssertEqual(object["ok"] as? Bool, true)
        let rows = try XCTUnwrap(object["result"] as? [[String: Any]])
        XCTAssertEqual(rows.first?["k"] as? String, "1,2,3")
        XCTAssertEqual(BridgeCodec.result(id: 4, json: Data()), #"{"type":"result","id":4,"ok":true,"result":null}"#)
    }

    func testEncodesAFailure() throws {
        let message = BridgeCodec.failure(id: 9, message: #"refused: "no" \ really"#)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(message.utf8)) as? [String: Any])
        XCTAssertEqual(object["ok"] as? Bool, false)
        XCTAssertEqual(object["id"] as? Int, 9)
        XCTAssertEqual(object["error"] as? String, #"refused: "no" \ really"#)
    }

    func testEncodesStartWithInsets() throws {
        let start = GameStart(contextId: "ctx", myId: "me", name: "Ana", worldName: "Lime Valley", sensitivity: 1.5)
        let message = BridgeCodec.start(start, insets: GameInsets(top: 0, left: 47, bottom: 21, right: 47))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(message.utf8)) as? [String: Any])
        XCTAssertEqual(object["type"] as? String, "start")
        XCTAssertEqual(object["contextId"] as? String, "ctx")
        XCTAssertEqual(object["myId"] as? String, "me")
        XCTAssertEqual(object["name"] as? String, "Ana")
        XCTAssertEqual(object["worldName"] as? String, "Lime Valley")
        XCTAssertEqual(object["sensitivity"] as? Double, 1.5)
        XCTAssertEqual((object["insets"] as? [String: Any])?["left"] as? Double, 47)
    }

    func testEncodesTheAppsOneWayMessages() {
        XCTAssertEqual(BridgeCodec.pause, #"{"type":"pause"}"#)
        XCTAssertEqual(BridgeCodec.resume, #"{"type":"resume"}"#)
        XCTAssertEqual(BridgeCodec.event(kind: "StateMutation"), #"{"kind":"StateMutation","type":"event"}"#)
        XCTAssertEqual(BridgeCodec.settings(sensitivity: 2), #"{"sensitivity":2,"type":"settings"}"#)
    }

    /// The script carries the message as a JS string literal: quotes, backslashes, a closing
    /// script tag and line breaks inside it never break out into code.
    func testTheScriptPassesTheMessageAsAStringLiteral() throws {
        let message = BridgeCodec.failure(id: 1, message: "a \"quote\", a \\ backslash, </script>, a\nnewline and \u{2028}")
        let script = BridgeCodec.script(message)
        let prefix = "window.meroBridge&&window.meroBridge.receive("
        XCTAssertTrue(script.hasPrefix(prefix))
        XCTAssertTrue(script.hasSuffix(");"))
        let literal = String(script.dropFirst(prefix.count).dropLast(2))
        XCTAssertTrue(literal.hasPrefix("\"") && literal.hasSuffix("\""))
        XCTAssertFalse(literal.contains("\n"), "a raw newline would end the statement")
        let decoded = try JSONSerialization.jsonObject(with: Data(literal.utf8), options: [.fragmentsAllowed]) as? String
        XCTAssertEqual(decoded, message)
    }
}

/// Contract calls from the page go through the generated client on the right path, with typed
/// arguments; nothing else gets through.
final class BridgeRouterTests: XCTestCase {
    private let contextId = String(repeating: "cc", count: 32)
    private var recording: RecordingContextContract!
    private var router: BridgeRouter!

    override func setUp() {
        recording = RecordingContextContract()
        recording.setHandler { call in
            switch call.method {
            case "world_meta": return .object(["name": "Lime Valley", "seed": 1337, "createdAt": 1_730_000_000])
            case "get_overrides": return .array([.object(["k": "1,2,3", "b": 8])])
            case "get_players":
                return .array([
                    .object([
                        "id": .string(String(repeating: "ab", count: 32)), "name": "Ana", "x": 1.5, "y": 30, "z": 2,
                        "yaw": 0.5, "pitch": 0, "sel": 2, "online": true,
                    ])
                ])
            case "join":
                return .object([
                    "id": "me", "name": "Ana", "x": 0, "y": 0, "z": 0, "yaw": 0, "pitch": 0, "sel": 0, "online": true,
                ])
            case "set_blocks": return .number(2)
            default: return .null
            }
        }
        router = BridgeRouter(client: BlocksClient(transport: recording.bound(to: contextId)))
    }

    private func json(_ data: Data) throws -> Any {
        try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    func testViewsAreQueries() async throws {
        let meta = try await router.handle(op: .query, method: "world_meta", argsJSON: Data("{}".utf8))
        let object = try XCTUnwrap(try json(meta) as? [String: Any])
        XCTAssertEqual(object["seed"] as? Int, 1337)
        XCTAssertEqual(object["createdAt"] as? Int, 1_730_000_000)
        XCTAssertEqual(recording.calls("world_meta").first?.path, .query)
        XCTAssertEqual(recording.calls("world_meta").first?.contextId, contextId)

        let players = try await router.handle(op: .query, method: "get_players", argsJSON: Data(#"{"now":1730000001}"#.utf8))
        let rows = try XCTUnwrap(try json(players) as? [[String: Any]])
        XCTAssertEqual(rows.first?["name"] as? String, "Ana")
        XCTAssertEqual(rows.first?["online"] as? Bool, true)
        XCTAssertEqual(recording.calls("get_players").first?.args, .object(["now": 1_730_000_001]))

        let overrides = try await router.handle(op: .query, method: "get_overrides", argsJSON: Data("{}".utf8))
        XCTAssertEqual((try json(overrides) as? [[String: Any]])?.first?["b"] as? Int, 8)
    }

    func testMutationsAreSignedExecutes() async throws {
        let heartbeat = #"{"t":{"name":"Ana","x":12.5,"y":30,"z":-4.25,"yaw":1.571,"pitch":-0.2,"sel":3},"now":1730000000}"#
        let unit = try await router.handle(op: .execute, method: "heartbeat", argsJSON: Data(heartbeat.utf8))
        XCTAssertEqual(String(decoding: unit, as: UTF8.self), "null")
        let call = try XCTUnwrap(recording.calls("heartbeat").first)
        XCTAssertEqual(call.path, .execute)
        guard case .object(let args) = call.args, case .object(let t)? = args["t"] else { return XCTFail("no t") }
        XCTAssertEqual(t["x"], .number(12.5))
        XCTAssertEqual(t["sel"], .number(3))
        XCTAssertEqual(args["now"], .number(1_730_000_000))

        let edits = #"{"edits":[{"x":10,"y":31,"z":12,"b":0},{"x":10,"y":32,"z":12,"b":8}],"now":1730000002}"#
        let applied = try await router.handle(op: .execute, method: "set_blocks", argsJSON: Data(edits.utf8))
        XCTAssertEqual(String(decoding: applied, as: UTF8.self), "2")
        guard case .object(let sent)? = recording.calls("set_blocks").first?.args, case .array(let list)? = sent["edits"]
        else { return XCTFail("no edits") }
        XCTAssertEqual(list.count, 2)

        let joined = try await router.handle(op: .execute, method: "join", argsJSON: Data(#"{"name":"Ana","now":1}"#.utf8))
        XCTAssertEqual((try json(joined) as? [String: Any])?["id"] as? String, "me")
        _ = try await router.handle(op: .execute, method: "leave", argsJSON: Data(#"{"now":2}"#.utf8))
        XCTAssertEqual(recording.calls.map(\.path), [.execute, .execute, .execute, .execute])
    }

    func testRefusesMethodsTheGameDoesNotUse() async {
        for method in ["init", "drop_world", ""] {
            do {
                _ = try await router.handle(op: .execute, method: method, argsJSON: Data("{}".utf8))
                XCTFail("\(method) got through")
            } catch {
                XCTAssertEqual(error as? BridgeError, .unknownMethod(method))
            }
        }
        XCTAssertTrue(recording.calls.isEmpty)
    }

    func testRefusesTheWrongPath() async {
        do {
            _ = try await router.handle(op: .query, method: "set_blocks", argsJSON: Data(#"{"edits":[],"now":1}"#.utf8))
            XCTFail("a mutation went through query")
        } catch {
            XCTAssertEqual(error as? BridgeError, .wrongPath(method: "set_blocks", expected: .execute))
        }
        do {
            _ = try await router.handle(op: .execute, method: "get_players", argsJSON: Data(#"{"now":1}"#.utf8))
            XCTFail("a view went through execute")
        } catch {
            XCTAssertEqual(error as? BridgeError, .wrongPath(method: "get_players", expected: .query))
        }
        XCTAssertTrue(recording.calls.isEmpty)
    }

    func testRefusesArgumentsOfTheWrongShape() async {
        for (method, args) in [
            ("get_players", #"{}"#), ("set_blocks", #"{"edits":[{"x":"a"}],"now":1}"#), ("join", #"{"now":1}"#),
            ("set_blocks", #"{"edits":[{"x":1,"y":2,"z":3,"b":-1}],"now":1}"#),
            ("set_blocks", #"{"edits":[{"x":1,"y":2,"z":3,"b":16}],"now":1}"#),
        ] {
            let op: BridgeOp = BridgeRouter.views.contains(method) ? .query : .execute
            do {
                _ = try await router.handle(op: op, method: method, argsJSON: Data(args.utf8))
                XCTFail("\(method) \(args) got through")
            } catch {
                guard case .badArguments(let m, _)? = error as? BridgeError else { return XCTFail("\(error)") }
                XCTAssertEqual(m, method)
            }
        }
        XCTAssertTrue(recording.calls.isEmpty)
    }
}
