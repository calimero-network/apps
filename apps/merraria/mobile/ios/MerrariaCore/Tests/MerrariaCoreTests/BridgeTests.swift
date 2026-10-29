import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest

@testable import MerrariaCore

final class BridgeTests: XCTestCase {
    // MARK: Page -> app

    func testDecodesContractRequests() throws {
        let message = PageMessage.decode(
            #"{"type":"request","id":7,"op":"execute","method":"set_tiles","args":{"edits":[{"x":1,"y":-2,"t":0}],"now":5}}"#)
        guard case .request(let id, let op, let method, let args) = message else {
            return XCTFail("not a request: \(String(describing: message))")
        }
        XCTAssertEqual(id, 7)
        XCTAssertEqual(op, .execute)
        XCTAssertEqual(method, "set_tiles")
        XCTAssertEqual(String(decoding: args, as: UTF8.self), #"{"edits":[{"t":0,"x":1,"y":-2}],"now":5}"#)
    }

    func testDecodesConfigRequestWithoutMethod() {
        XCTAssertEqual(
            PageMessage.decode(#"{"type":"request","id":1,"op":"config"}"#),
            .request(id: 1, op: .config, method: "", argsJSON: Data("{}".utf8)))
    }

    func testDecodesHudStatusFatalAndLeft() {
        XCTAssertEqual(
            PageMessage.decode(
                ##"{"type":"hud","sel":2,"slots":[{"id":1,"name":"dirt","color":"#8a5a33","count":4},{"id":3,"name":"stone","color":"7e8288","count":0}]}"##),
            .hud(
                selected: 2,
                slots: [
                    HudSlot(id: 1, name: "dirt", color: 0x8A5A33, count: 4),
                    HudSlot(id: 3, name: "stone", color: 0x7E8288, count: 0),
                ]))
        XCTAssertEqual(PageMessage.decode(#"{"type":"status","state":"connected"}"#), .connected)
        XCTAssertEqual(PageMessage.decode(#"{"type":"fatal","message":"gone"}"#), .fatal("gone"))
        XCTAssertEqual(PageMessage.decode(#"{"type":"left"}"#), .left)
    }

    func testRefusesMalformedMessages() {
        XCTAssertNil(PageMessage.decode("not json"))
        XCTAssertNil(PageMessage.decode(#"{"type":"request","id":1,"op":"delete","method":"x"}"#))
        XCTAssertNil(PageMessage.decode(#"{"type":"request","op":"query","method":"world_meta"}"#))
        XCTAssertNil(PageMessage.decode(#"{"type":"request","id":1,"op":"query"}"#))
        XCTAssertNil(PageMessage.decode(#"{"type":"status","state":"other"}"#))
        XCTAssertNil(PageMessage.decode(#"{"type":"mystery"}"#))
    }

    // MARK: App -> page

    func testEncodesResponses() {
        XCTAssertEqual(
            AppMessage.response(id: 3, result: .success(#"[{"k":"1,2","t":0}]"#)).json,
            #"{"type":"response","id":3,"ok":true,"value":[{"k":"1,2","t":0}]}"#)
        XCTAssertEqual(
            AppMessage.response(id: 4, result: .success("")).json,
            #"{"type":"response","id":4,"ok":true,"value":null}"#)
        XCTAssertEqual(
            AppMessage.response(id: 5, result: .success("not json")).json,
            #"{"type":"response","id":5,"ok":true,"value":"not json"}"#)
        XCTAssertEqual(
            AppMessage.response(id: 6, result: .failure(BridgeFailure(#"{"type":"Uninitialized"} "quoted""#))).json,
            #"{"type":"response","id":6,"ok":false,"error":"{\"type\":\"Uninitialized\"} \"quoted\""}"#)
    }

    func testEncodesControlMessages() {
        XCTAssertEqual(
            AppMessage.input(GameInput(move: -1, jump: true, jumpPressed: true, mine: false, place: true)).json,
            #"{"type":"input","move":-1,"jump":true,"jumpPressed":true,"mine":false,"place":true}"#)
        XCTAssertEqual(AppMessage.target(x: 120, y: 64.5).json, #"{"type":"target","x":120,"y":64.5}"#)
        XCTAssertEqual(AppMessage.select(slot: 3).json, #"{"type":"select","slot":3}"#)
        XCTAssertEqual(AppMessage.zoom(1.3).json, #"{"type":"zoom","value":1.3}"#)
        XCTAssertEqual(AppMessage.pause.json, #"{"type":"pause"}"#)
        XCTAssertEqual(AppMessage.leave.json, #"{"type":"leave"}"#)
        XCTAssertEqual(AppMessage.event(kind: "StateMutation").json, #"{"type":"event","kind":"StateMutation"}"#)
        XCTAssertEqual(
            AppMessage.pause.script, #"window.meroBridge && window.meroBridge.receive({"type":"pause"});"#)
    }

    func testEncodesConfig() {
        XCTAssertEqual(
            GameConfig(contextId: "ctx", name: "Ada \"A\"", zoom: 1).json,
            #"{"contextId":"ctx","name":"Ada \"A\"","zoom":1}"#)
    }

    // MARK: Dispatch through the generated client

    private func dispatcher() -> (BridgeDispatcher, InMemoryAppBackend) {
        let backend = InMemoryAppBackend()
        backend.recording.setHandler { call in
            switch call.method {
            case "get_overrides": return .array([.object(["k": .string("4,5"), "t": .number(3)])])
            case "world_meta":
                return .object(["name": .string("surface"), "seed": .number(1337), "createdAt": .number(10)])
            case "join":
                return .object([
                    "id": .string("dev1"), "name": .string("Ada"), "x": .number(1.5), "y": .number(2),
                    "dir": .number(1), "sel": .number(0), "action": .string("idle"), "online": .bool(true),
                ])
            case "set_tiles": return .number(1)
            default: return .null
            }
        }
        return (BridgeDispatcher(client: .bound(backend, contextId: "ctx1")), backend)
    }

    func testViewsGoThroughQueryAndWritesThroughExecute() async throws {
        let (dispatcher, backend) = dispatcher()
        let overrides = try await dispatcher.run(op: .query, method: "get_overrides", argsJSON: Data("{}".utf8))
        XCTAssertEqual(overrides, #"[{"k":"4,5","t":3}]"#)
        let applied = try await dispatcher.run(
            op: .execute, method: "set_tiles", argsJSON: Data(#"{"edits":[{"x":4,"y":5,"t":0}],"now":99}"#.utf8))
        XCTAssertEqual(applied, "1")
        let heartbeat = try await dispatcher.run(
            op: .execute, method: "heartbeat",
            argsJSON: Data(
                #"{"t":{"name":"Ada","x":1.25,"y":2,"dir":-1,"sel":2,"action":"walking"},"now":100}"#.utf8))
        XCTAssertEqual(heartbeat, "null")

        let calls = backend.recording.calls
        XCTAssertEqual(calls.map(\.method), ["get_overrides", "set_tiles", "heartbeat"])
        XCTAssertEqual(calls.map(\.path), [.query, .execute, .execute])
        XCTAssertEqual(calls.map(\.contextId), ["ctx1", "ctx1", "ctx1"])
        XCTAssertEqual(
            calls[1].args,
            .object(["edits": .array([.object(["x": .number(4), "y": .number(5), "t": .number(0)])]), "now": .number(99)]))
        XCTAssertEqual(calls[2].args["t"]?["action"], .string("walking"))
    }

    func testJoinReturnsThePlayerView() async throws {
        let (dispatcher, _) = dispatcher()
        let joined = try await dispatcher.run(
            op: .execute, method: "join", argsJSON: Data(#"{"name":"Ada","now":5}"#.utf8))
        let view = try JSONDecoder().decode(PlayerView.self, from: Data(joined.utf8))
        XCTAssertEqual(view.id, "dev1")
    }

    func testRefusesWrongKindUnknownMethodsInitAndBadArgs() async {
        let (dispatcher, backend) = dispatcher()
        for (op, method, args) in [
            (BridgeOp.execute, "get_overrides", "{}"),
            (.query, "set_tiles", #"{"edits":[],"now":1}"#),
            (.execute, "init", #"{"name":"x","seed":1,"now":1}"#),
            (.query, "drop_tables", "{}"),
            (.execute, "set_tiles", #"{"edits":"nope","now":1}"#),
        ] {
            do {
                _ = try await dispatcher.run(op: op, method: method, argsJSON: Data(args.utf8))
                XCTFail("\(method) via \(op) should have been refused")
            } catch {
                XCTAssertTrue(error is BridgeFailure, "\(error)")
            }
        }
        XCTAssertTrue(backend.recording.calls.isEmpty)
    }
}
