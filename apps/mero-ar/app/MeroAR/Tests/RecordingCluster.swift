import Foundation
import MeroKit
@testable import MeroAR

/// A ``RoomCluster`` that records what the app sends and answers what a test
/// scripts: the contract calls, blob uploads and reads, with no network.
final class RecordingCluster: RoomCluster, @unchecked Sendable {
    struct Call: Equatable {
        let method: String
        let args: [String: JSONValue]
    }

    private let lock = NSLock()
    private var _calls: [Call] = []
    private var _uploads: [Data] = []
    /// What `view` answers, by method.
    var views: [String: JSONValue] = [:]
    /// Stored blobs, by id.
    var blobs: [String: Data] = [:]
    /// The id the next upload answers.
    var uploadId = String(repeating: "9f", count: 32)
    /// When set, every write is refused with this (as a contract error).
    var refuseWrites: String?

    var endpoint: String { "https://recording.test" }

    var calls: [Call] { lock.withLock { _calls } }
    var uploads: [Data] { lock.withLock { _uploads } }

    func writes(_ method: String) -> [Call] { calls.filter { $0.method == method } }

    func view(app: String, method: String, args: [String: JSONValue]) async throws -> JSONValue? {
        views[method]
    }

    @discardableResult
    func call(app: String, method: String, args: [String: JSONValue]) async throws -> JSONValue? {
        lock.withLock { _calls.append(Call(method: method, args: args)) }
        if let refuseWrites { throw FixtureCluster.Failure(status: 403, message: refuseWrites) }
        return nil
    }

    func events(app: String) -> AsyncThrowingStream<CloudEvent, Error> { AsyncThrowingStream { $0.finish() } }

    func uploadBlob(app: String, data: Data) async throws -> String {
        lock.withLock { _uploads.append(data) }
        blobs[uploadId] = data
        return uploadId
    }

    func downloadBlob(app: String, id: String) async throws -> Data {
        guard let data = blobs[id] else { throw FixtureCluster.Failure(status: 404, message: "no such blob") }
        return data
    }

    func listHomes() async throws -> HomeListing { HomeListing(homes: []) }
    func createHome(named name: String) async throws -> String { "org" }
    func createRoom(named name: String, inHome homeId: String) async throws -> String { "app" }
    func home(ofRoom app: String) async throws -> String? { nil }
    func homeName(_ homeId: String) async throws -> String { "" }
    func invite(toHome homeId: String) async throws -> String { "inv_test" }
    func redeem(token: String) async throws {}
    func availableUpdate(app: String) async throws -> RoomUpdate? { nil }

    /// A service for one room on this cluster.
    func service(app: String = "app-1", member: String = String(repeating: "ab", count: 32)) -> MeroARService {
        MeroARService(cluster: self, contextId: app, memberId: member)
    }
}
