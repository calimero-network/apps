import Foundation
import MeroKit

/// Mero AR's identity on the cluster.
public enum MeroARPackage {
    /// The registry package rooms are created from (`[package.metadata.calimero]`).
    public static let id = "com.calimero.mero-ar"
}

/// One room's contract as the generated ``MeroArClient`` calls it: views and
/// calls over a ``RoomCluster`` (the sealed channel to the person's cluster, or
/// a fixture), in the app instance `app`.
public struct RoomContract: ContextContractCalling {
    public let cluster: any RoomCluster
    public let app: String

    public init(cluster: any RoomCluster, app: String) {
        self.cluster = cluster
        self.app = app
    }

    public func query(method: String, argsJSON: Data) async throws -> Data {
        try Self.encode(try await cluster.view(app: app, method: method, args: try Self.decode(argsJSON)))
    }

    public func execute(method: String, argsJSON: Data) async throws -> Data {
        try Self.encode(try await cluster.call(app: app, method: method, args: try Self.decode(argsJSON)))
    }

    static func decode(_ data: Data) throws -> [String: JSONValue] {
        guard !data.isEmpty, case let .object(args) = try MeroJSON.decode(JSONValue.self, from: data) else { return [:] }
        return args
    }

    static func encode(_ value: JSONValue?) throws -> Data { try MeroJSON.encode(value ?? .null) }
}
