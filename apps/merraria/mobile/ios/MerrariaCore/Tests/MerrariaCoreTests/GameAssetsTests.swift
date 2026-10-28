import Foundation
import XCTest

@testable import MerrariaCore

/// The bundle both apps ship (`mobile/game/www`) is there, complete, and local.
final class GameAssetsTests: XCTestCase {
    private var root: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("game").appendingPathComponent(GameAssets.folder)
    }

    func testTheBundledGameIsCompleteAndLocal() throws {
        let index = try XCTUnwrap(GameAssets.resolve(path: "/index.html", in: root), "run scripts/build-game.sh")
        let html = try String(contentsOf: index, encoding: .utf8)
        let files = GameAssets.referencedFiles(indexHTML: html)
        XCTAssertTrue(files.contains { $0.hasPrefix("assets/") && $0.hasSuffix(".js") }, "\(files)")
        XCTAssertTrue(files.contains { $0.hasSuffix(".css") }, "\(files)")
        for file in files {
            XCTAssertNotNil(GameAssets.resolve(path: "/" + file, in: root), "missing \(file)")
        }
        // The page loads nothing from the network: no remote script, stylesheet or font.
        XCTAssertFalse(html.contains(#"src="http"#))
        XCTAssertFalse(html.contains("stylesheet\" href=\"http"))
        // And it is the build with the native host in it.
        let scripts = files.filter { $0.hasSuffix(".js") }.compactMap { GameAssets.resolve(path: $0, in: root) }
        let code = try scripts.map { try String(contentsOf: $0, encoding: .utf8) }.joined()
        XCTAssertTrue(code.contains("MeroBridgeAndroid"))
        XCTAssertTrue(code.contains("meroBridge"))
    }

    func testResolvesOnlyFilesInsideTheGame() {
        XCTAssertNotNil(GameAssets.resolve(path: "/", in: root))
        XCTAssertNil(GameAssets.resolve(path: "/../ios/project.yml", in: root))
        XCTAssertNil(GameAssets.resolve(path: "/assets", in: root))
        XCTAssertNil(GameAssets.resolve(path: "/nope.js", in: root))
    }

    func testMimeTypes() {
        XCTAssertEqual(GameAssets.mimeType(for: URL(fileURLWithPath: "/a/x.js")), "text/javascript; charset=utf-8")
        XCTAssertEqual(GameAssets.mimeType(for: URL(fileURLWithPath: "/a/f.woff2")), "font/woff2")
        XCTAssertEqual(GameAssets.mimeType(for: URL(fileURLWithPath: "/a/i.html")), "text/html; charset=utf-8")
    }
}
