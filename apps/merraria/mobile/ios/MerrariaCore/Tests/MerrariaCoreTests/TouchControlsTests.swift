import XCTest

@testable import MerrariaCore

final class TouchControlsTests: XCTestCase {
    func testDpadMovesAndCancelsOut() {
        var controls = TouchControls()
        XCTAssertEqual(controls.press(.left), GameInput(move: -1))
        XCTAssertEqual(controls.press(.right), GameInput(move: 0))
        XCTAssertEqual(controls.release(.left), GameInput(move: 1))
        XCTAssertEqual(controls.release(.right), GameInput.idle)
    }

    func testJumpIsAnEdgeOnThePressAndALevelWhileHeld() {
        var controls = TouchControls()
        XCTAssertEqual(controls.press(.jump), GameInput(jump: true, jumpPressed: true))
        XCTAssertEqual(controls.press(.right), GameInput(move: 1, jump: true, jumpPressed: false))
        XCTAssertEqual(controls.input, GameInput(move: 1, jump: true))
        XCTAssertEqual(controls.release(.jump), GameInput(move: 1))
    }

    func testMineAndPlaceAreHeldAndMiningWins() {
        var controls = TouchControls()
        XCTAssertEqual(controls.press(.place), GameInput(place: true))
        XCTAssertEqual(controls.press(.mine), GameInput(mine: true, place: false))
        XCTAssertEqual(controls.release(.mine), GameInput(place: true))
    }

    func testRepeatsAndStrayReleasesSendNothing() {
        var controls = TouchControls()
        XCTAssertNil(controls.release(.mine))
        XCTAssertNotNil(controls.press(.mine))
        XCTAssertNil(controls.press(.mine))
        var idle = TouchControls()
        XCTAssertNil(idle.releaseAll())
    }

    func testReleaseAllLiftsEverything() {
        var controls = TouchControls()
        _ = controls.press(.left)
        _ = controls.press(.mine)
        XCTAssertEqual(controls.releaseAll(), GameInput.idle)
        XCTAssertTrue(controls.held.isEmpty)
    }

    func testTapsBecomeCSSPixels() {
        XCTAssertEqual(TouchControls.tapTarget(x: 120.4, y: 64.6), .target(x: 120, y: 65))
        XCTAssertEqual(TouchControls.tapTarget(x: 300, y: 150, unitsPerCSSPixel: 3), .target(x: 100, y: 50))
        XCTAssertEqual(TouchControls.tapTarget(x: 10, y: 20, unitsPerCSSPixel: 0), .target(x: 10, y: 20))
    }

    func testHotbarSelectionStaysInTheHotbar() {
        XCTAssertEqual(TouchControls.select(4, slotCount: 9), .select(slot: 4))
        XCTAssertEqual(TouchControls.select(12, slotCount: 9), .select(slot: 8))
        XCTAssertEqual(TouchControls.select(-1, slotCount: 9), .select(slot: 0))
        XCTAssertNil(TouchControls.select(0, slotCount: 0))
    }

    func testSeedsAreReadLikeTheWebApp() {
        XCTAssertEqual(MerrariaConstants.seed(from: "1337", fallback: 1), 1337)
        XCTAssertEqual(MerrariaConstants.seed(from: "-42.9", fallback: 1), 43)
        XCTAssertEqual(MerrariaConstants.seed(from: "abc", fallback: 7), 7)
        XCTAssertEqual(MerrariaConstants.seed(from: "0", fallback: 7), 7)
    }
}
