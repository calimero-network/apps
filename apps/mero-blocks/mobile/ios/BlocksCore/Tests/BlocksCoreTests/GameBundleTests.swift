import Foundation
import XCTest

/// The game page the app bundles (project.yml copies `../game/assets/game` into the app as the
/// `game` folder). Checked here so a missing or stale build fails `swift test`, not the phone.
final class GameBundleTests: XCTestCase {
    private var folder: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // BlocksCoreTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // BlocksCore
            .deletingLastPathComponent()  // ios
            .deletingLastPathComponent()  // mobile
            .appendingPathComponent("game/assets/game")
    }

    func testThePageAndItsScriptAreThere() throws {
        let html = try String(contentsOf: folder.appendingPathComponent("index.html"), encoding: .utf8)
        XCTAssertTrue(html.contains(#"<script src="./game.js"></script>"#), "one classic script, loaded locally")
        XCTAssertFalse(html.contains("type=\"module\""), "a module script does not load from file://")
        XCTAssertFalse(html.contains("http://") || html.contains("https://"), "nothing is fetched at run time")

        let script = try String(contentsOf: folder.appendingPathComponent("game.js"), encoding: .utf8)
        XCTAssertGreaterThan(script.utf8.count, 100_000, "three.js and the engine are inlined")
        for needle in ["meroBridge", "messageHandlers", "meroBlocks", "MeroBlocksAndroid", "set_blocks", "get_players"] {
            XCTAssertTrue(script.contains(needle), "game.js has no \(needle)")
        }
        XCTAssertFalse(script.contains("import("), "no dynamic imports: everything is in one file")
    }
}
