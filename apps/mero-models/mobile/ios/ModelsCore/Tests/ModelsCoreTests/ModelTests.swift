import Foundation
import MeroKit
import MeroKitTestSupport
import XCTest
@testable import ModelsCore

/// The same cases as the Android `ModelTest`, against the SDK's in-memory backend.
@MainActor
final class ModelTests: XCTestCase {
    private let clock = { Date(timeIntervalSince1970: Double(Fixtures.now) / 1000) }

    func testStudiosListThisAccountsStudios() async {
        let backend = Fixtures.backend()
        backend.namespaces.append(AppNamespace(id: "zz", name: nil, applicationId: "x"))
        let model = StudiosModel(backend: backend)
        await model.load()
        XCTAssertEqual(model.state, .loaded)
        XCTAssertEqual(model.studios.map(\.name), ["Props", "Studio zz"])
    }

    func testAStudiosFailureIsShown() async {
        let backend = Fixtures.backend()
        backend.failure = URLError(.notConnectedToInternet)
        let model = StudiosModel(backend: backend)
        await model.load()
        XCTAssertEqual(model.state, .failed("You're offline. Check your connection and try again."))
    }

    func testScenesTakeTheScenesOwnName() async {
        let model = ScenesModel(backend: Fixtures.backend(), studioId: Fixtures.studio)
        await model.load()
        let scene = try? XCTUnwrap(model.scenes.first)
        XCTAssertEqual(model.scenes.count, 1)
        XCTAssertEqual(scene?.name, "Crate kit")
        XCTAssertEqual(scene?.objectCount, 3)
        XCTAssertEqual(scene?.memberCount, 2)
    }

    func testSceneReadsEverythingThroughQuery() async {
        let backend = Fixtures.backend()
        let model = SceneModel(backend: backend, studioId: Fixtures.studio, contextId: Fixtures.scene, now: clock)
        await model.open()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.name, "Crate kit")
        XCTAssertEqual(model.objects.count, 4)
        XCTAssertTrue(backend.recording.calls.allSatisfy { $0.path == .query })
        XCTAssertEqual(backend.recording.calls("list_locks").first?.args["now"], .number(Double(Fixtures.now)))
        XCTAssertNotNil(model.viewerJSON())
    }

    func testOutlineIsTheHierarchyInCreationOrder() async {
        let model = SceneModel(backend: Fixtures.backend(), studioId: Fixtures.studio, contextId: Fixtures.scene, now: clock)
        await model.open()
        XCTAssertEqual(model.outline.map(\.object.id), ["sun", "crate", "lid", "orphan"])
        XCTAssertEqual(model.outline.map(\.depth), [0, 0, 1, 0])
        XCTAssertEqual(model.outline.first { $0.id == "crate" }?.lock?.holder, Fixtures.ana)
    }

    func testCheckOutsAreLiveNewestFirstAndNamed() async {
        let model = SceneModel(backend: Fixtures.backend(), studioId: Fixtures.studio, contextId: Fixtures.scene, now: clock)
        await model.open()
        let rows = model.checkOuts
        XCTAssertEqual(rows.map(\.assetId), ["tex1", "crate"])
        XCTAssertEqual(rows.map(\.holderName), ["You", "Ana"])
        XCTAssertEqual(rows.map(\.assetName), ["Crate albedo", "Crate"])
        XCTAssertEqual(rows.map(\.assetKind), ["texture", "mesh"])
    }

    func testGuestIsNoName() async {
        let model = SceneModel(backend: Fixtures.backend(), studioId: Fixtures.studio, contextId: Fixtures.scene, now: clock)
        await model.open()
        XCTAssertEqual(model.name(for: Fixtures.me), ModelsFormat.shortId(Fixtures.me))
        XCTAssertEqual(model.name(for: Fixtures.ana), "Ana")
    }

    func testOpeningASceneThisAccountIsNotInJoinsIt() async {
        let backend = Fixtures.backend(memberOfScene: false)
        let model = SceneModel(backend: backend, studioId: Fixtures.studio, contextId: Fixtures.scene, now: clock)
        await model.open()
        XCTAssertTrue(backend.log.contains("joinContext \(Fixtures.scene)"))
        XCTAssertEqual(model.phase, .ready)
    }

    func testAFailedReadIsShown() async {
        let backend = Fixtures.backend()
        backend.recording.setRawHandler { _ in throw URLError(.notConnectedToInternet) }
        let model = SceneModel(backend: backend, studioId: Fixtures.studio, contextId: Fixtures.scene, now: clock)
        await model.open()
        XCTAssertEqual(model.phase, .failed("You're offline. Check your connection and try again."))
    }

    func testAnEventRereadsTheScene() async throws {
        let backend = Fixtures.backend()
        let model = SceneModel(backend: backend, studioId: Fixtures.studio, contextId: Fixtures.scene, now: clock)
        await model.open()
        let before = backend.recording.calls("get_objects").count
        let live = Task { await model.live() }
        try await Task.sleep(nanoseconds: 50_000_000)
        backend.emit(AppContextEvent(contextId: Fixtures.scene, kind: "StateMutation"))
        try await Task.sleep(nanoseconds: 200_000_000)
        live.cancel()
        XCTAssertGreaterThan(backend.recording.calls("get_objects").count, before)
    }

    func testBlobsAreReadOnce() async {
        final class Counting: BlobLoading, @unchecked Sendable {
            var count = 0
            func blob(id: String, contextId: String) async throws -> Data {
                count += 1
                return Data([1, 2, 3])
            }
        }
        let blobs = Counting()
        let model = SceneModel(backend: Fixtures.backend(), studioId: Fixtures.studio, contextId: Fixtures.scene, blobs: blobs)
        let a = await model.blob("x")
        let b = await model.blob("x")
        XCTAssertEqual(a, Data([1, 2, 3]))
        XCTAssertEqual(b, a)
        XCTAssertEqual(blobs.count, 1)
    }
}
