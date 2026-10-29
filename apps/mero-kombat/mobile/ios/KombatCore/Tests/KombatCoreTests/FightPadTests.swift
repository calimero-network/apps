import XCTest

@testable import KombatCore

/// The fight pad → game input mapping. The Android app's `FightPadTest` asserts the same cases.
final class FightPadTests: XCTestCase {
    func testEveryButtonIsOneTheEngineReads() {
        // `Button` in app/src/game/input.ts.
        XCTAssertEqual(
            PadButton.allCases.map(\.rawValue), ["left", "right", "up", "down", "punch", "kick", "block", "special"])
        XCTAssertEqual(PadAction.rows.flatMap { $0 }.map(\.button), [.block, .special, .punch, .kick])
        XCTAssertEqual(PadAction.rows.flatMap { $0 }.map(\.key), ["L", "I", "J", "K"], "the web app's legend")
    }

    func testDPadHasADeadZone() {
        XCTAssertEqual(DPad.directions(dx: 0, dy: 0, radius: 60), [])
        XCTAssertEqual(DPad.directions(dx: 10, dy: -5, radius: 60), [])
    }

    func testDPadCardinals() {
        XCTAssertEqual(DPad.directions(dx: 50, dy: 0, radius: 60), [.right])
        XCTAssertEqual(DPad.directions(dx: -50, dy: 0, radius: 60), [.left])
        XCTAssertEqual(DPad.directions(dx: 0, dy: -50, radius: 60), [.up])
        XCTAssertEqual(DPad.directions(dx: 0, dy: 50, radius: 60), [.down])
    }

    func testDPadDiagonalsAndNearMisses() {
        XCTAssertEqual(DPad.directions(dx: 40, dy: 40, radius: 60), [.right, .down], "crouch-walk")
        XCTAssertEqual(DPad.directions(dx: -40, dy: -40, radius: 60), [.left, .up], "jump back")
        // 15° above horizontal is still a walk, not a jump: a sloppy thumb must not hop.
        XCTAssertEqual(DPad.directions(dx: 50, dy: -13, radius: 60), [.right])
        // Beyond the rim still counts.
        XCTAssertEqual(DPad.directions(dx: 200, dy: 0, radius: 60), [.right])
    }

    func testTrackerSendsEachChangeOnce() {
        var pad = PadTracker()
        XCTAssertEqual(pad.update([.right]), [.press(.right, down: true)])
        XCTAssertEqual(pad.update([.right]), [], "holding is not re-sent")
        XCTAssertEqual(
            pad.update([.right, .down, .punch]), [.press(.down, down: true), .press(.punch, down: true)],
            "crouch before punch: an uppercut")
        XCTAssertEqual(pad.update([.down]), [.press(.right, down: false), .press(.punch, down: false)])
        XCTAssertEqual(pad.releaseAll(), [.press(.down, down: false)])
        XCTAssertEqual(pad.held, [])
        XCTAssertEqual(pad.releaseAll(), [])
    }
}
