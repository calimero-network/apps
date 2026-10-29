import XCTest

@testable import KombatCore

/// The wire form both sides of the bridge agree on (`web/src/protocol.ts`). The Android app's
/// `BridgeTest` pins the same strings.
final class BridgeTests: XCTestCase {
    func testDecodesEveryPageMessage() {
        XCTAssertEqual(BridgeInbound.decode(#"{"v":1,"op":"ready"}"#), .ready)
        XCTAssertEqual(
            BridgeInbound.decode(#"{"v":1,"op":"execute","id":7,"method":"act","args":{"round":1,"kind":"punch"}}"#),
            .call(id: 7, kind: .execute, method: "act", argsJSON: #"{"kind":"punch","round":1}"#))
        XCTAssertEqual(
            BridgeInbound.decode(#"{"v":1,"op":"query","id":8,"method":"arena"}"#),
            .call(id: 8, kind: .query, method: "arena", argsJSON: "{}"))
        XCTAssertEqual(
            BridgeInbound.decode(#"{"v":1,"op":"presence","slice":{"v":1,"seat":"p2","x":150}}"#),
            .presence(sliceJSON: #"{"seat":"p2","v":1,"x":150}"#))
        XCTAssertEqual(BridgeInbound.decode(#"{"v":1,"op":"over","over":true}"#), .over(true))
    }

    func testRefusesWhatIsNotAMessage() {
        XCTAssertNil(BridgeInbound.decode("not json"))
        XCTAssertNil(BridgeInbound.decode(#"{"op":"ready"}"#), "no version")
        XCTAssertNil(BridgeInbound.decode(#"{"v":2,"op":"ready"}"#), "a version this app does not speak")
        XCTAssertNil(BridgeInbound.decode(#"{"v":1,"op":"execute","method":"act"}"#), "a call without an id")
        XCTAssertNil(BridgeInbound.decode(#"{"v":1,"op":"query","id":1,"method":""}"#))
        XCTAssertNil(BridgeInbound.decode(#"{"v":1,"op":"presence","slice":3}"#))
        XCTAssertNil(BridgeInbound.decode(#"{"v":1,"op":"teleport"}"#))
    }

    func testEncodesEveryNativeMessage() {
        XCTAssertEqual(
            BridgeOutbound.boot(mode: .net, local: 1, fighters: ["kinetic", "cryo"], muted: false).json,
            #"{"t":"boot","mode":"net","local":1,"fighters":["kinetic","cryo"],"muted":false}"#)
        XCTAssertEqual(
            BridgeOutbound.boot(mode: .spectate, local: nil, fighters: ["jinzo", "cryo"], muted: true).json,
            #"{"t":"boot","mode":"spectate","local":null,"fighters":["jinzo","cryo"],"muted":true}"#)
        XCTAssertEqual(BridgeOutbound.state(viewJSON: #"{"round":1}"#).json, #"{"t":"state","view":{"round":1}}"#)
        XCTAssertEqual(BridgeOutbound.slice(json: #"{"seat":"p2"}"#).json, #"{"t":"slice","slice":{"seat":"p2"}}"#)
        XCTAssertEqual(BridgeOutbound.press(.punch, down: true).json, #"{"t":"press","b":"punch","d":true}"#)
        XCTAssertEqual(BridgeOutbound.press(.left, down: false).json, #"{"t":"press","b":"left","d":false}"#)
        XCTAssertEqual(BridgeOutbound.result(id: 3, valueJSON: "null").json, #"{"t":"result","id":3,"ok":true,"value":null}"#)
        XCTAssertEqual(
            BridgeOutbound.failure(id: 4, message: #"round "2" is over"#).json,
            #"{"t":"result","id":4,"ok":false,"error":"round \"2\" is over"}"#)
        XCTAssertEqual(BridgeOutbound.pause.json, #"{"t":"pause"}"#)
        XCTAssertEqual(BridgeOutbound.resume.json, #"{"t":"resume"}"#)
        XCTAssertEqual(BridgeOutbound.restart.json, #"{"t":"restart"}"#)
        XCTAssertEqual(BridgeOutbound.mute(true).json, #"{"t":"mute","on":true}"#)
    }

    func testEveryMessageIsValidJSONAndAGuardedCall() throws {
        let all: [BridgeOutbound] = [
            .boot(mode: .cpu, local: 0, fighters: ["kinetic", "cryo"], muted: false), .state(viewJSON: "{}"),
            .slice(json: "{}"), .press(.special, down: true), .result(id: 1, valueJSON: "[1,2]"),
            .failure(id: 2, message: "line\nbreak"), .pause, .resume, .restart, .mute(false),
        ]
        for message in all {
            XCTAssertNoThrow(try JSONSerialization.jsonObject(with: Data(message.json.utf8)), message.json)
            XCTAssertEqual(message.script, "window.meroGame&&window.meroGame.receive(\(message.json));")
        }
    }
}
