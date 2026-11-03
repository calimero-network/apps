import Foundation
import MeroKit

// The generated client (from v1's ABI) still types every element, member,
// comment and cursor: the component contract answers those shapes unchanged.
// Only the request differs, so `ComponentTransport` is the ONE place v1's wire
// is mapped onto the component's (the web app's `src/api/meroDesign.ts`):
//
// - method and argument names are camelCase (`add_comment` -> `addComment`,
//   `comment_id` -> `commentId`);
// - 64-bit integer ARGUMENTS travel as decimal strings (`timestamp`,
//   `updatedAt`, `createdAt`, and `x`/`y` of `addComment`, `updateElement`,
//   `updateCursor`);
// - `get_elements` answers at most 1,000 elements, so it is read page by page
//   through `getElementsPage` and handed back whole, as v1 answered it.

/// A board's contract client, for one app instance.
public typealias ClientFactory = @Sendable (_ contextId: String) -> DesignClient

extension MeroAppBackend {
    /// The generated client over this backend's contract, bound to the board's app instance.
    public func designClient(_ contextId: String) -> DesignClient {
        DesignClient(transport: ComponentTransport(contract: contract, appId: contextId))
    }
}

/// The generated client's transport, speaking the component contract's wire.
public struct ComponentTransport: ContextContractCalling {
    public let contract: any ContextContract
    public let appId: String
    /// Elements per `getElementsPage` read (the contract's largest page).
    public static let elementPage = 1_000

    public init(contract: any ContextContract, appId: String) {
        self.contract = contract
        self.appId = appId
    }

    public func query(method: String, argsJSON: Data) async throws -> Data {
        if method == "get_elements" { return try await allElements() }
        let wire = try Self.wire(method, argsJSON)
        return try Self.encode(try await contract.query(contextId: appId, method: wire.name, args: wire.args))
    }

    public func execute(method: String, argsJSON: Data) async throws -> Data {
        let wire = try Self.wire(method, argsJSON)
        return try Self.encode(try await contract.execute(contextId: appId, method: wire.name, args: wire.args))
    }

    /// Every element in paint order, read a page at a time.
    private func allElements() async throws -> Data {
        var items: [JSONValue] = []
        var cursor: JSONValue = .null
        while true {
            let page = try await contract.query(
                contextId: appId, method: "getElementsPage",
                args: .object(["cursor": cursor, "limit": .number(Double(Self.elementPage))]))
            items += page?["items"]?.arrayValue ?? []
            guard let next = page?["nextCursor"]?.stringValue, !next.isEmpty else { break }
            cursor = .string(next)
        }
        return try Self.encode(.array(items))
    }

    // MARK: Mapping

    /// Arguments that are 64-bit integers on every method that takes them.
    static let int64Args: Set<String> = ["timestamp", "updated_at", "created_at"]
    /// Methods whose `x` / `y` are 64-bit (`i64`) too.
    static let int64Points: Set<String> = ["add_comment", "update_element", "update_cursor"]
    /// Optional arguments the generated client leaves out when `nil`: the contract is sent `null`.
    static let optionalArgs: [String: [String]] = [
        "join": ["avatar"], "update_board": ["name", "description"], "get_elements_page": ["cursor"],
    ]

    /// The component's method name and arguments for a v1 call.
    static func wire(_ method: String, _ argsJSON: Data) throws -> (name: String, args: JSONValue) {
        let decoded = argsJSON.isEmpty ? JSONValue.object([:]) : try JSONDecoder().decode(JSONValue.self, from: argsJSON)
        var out: [String: JSONValue] = [:]
        for (key, value) in decoded.objectValue ?? [:] {
            let int64 = int64Args.contains(key) || (int64Points.contains(method) && (key == "x" || key == "y"))
            out[camel(key)] = int64 ? decimal(value) : value
        }
        for key in optionalArgs[method] ?? [] where out[camel(key)] == nil { out[camel(key)] = .null }
        return (camel(method), .object(out))
    }

    /// `add_comment` -> `addComment`.
    static func camel(_ snake: String) -> String {
        let parts = snake.split(separator: "_", omittingEmptySubsequences: true)
        guard let first = parts.first else { return snake }
        return String(first) + parts.dropFirst().map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined()
    }

    /// A 64-bit integer as the contract takes it: a decimal string (`null` stays `null`).
    static func decimal(_ value: JSONValue) -> JSONValue {
        switch value {
        case .number(let n): return .string(String(Int64(n.rounded(.towardZero))))
        default: return value
        }
    }

    static func encode(_ value: JSONValue?) throws -> Data {
        try JSONEncoder().encode(value ?? .null)
    }
}

/// Image bytes stored as blobs on the board's app instance.
public protocol BlobLoading: Sendable {
    func blob(id: String, contextId: String) async throws -> Data
}

/// Blobs through the signed-in backend: on Calimero 1.0, `GET /apps/{app}/blobs/{id}`.
public struct BackendBlobs: BlobLoading {
    public let backend: any MeroAppBackend

    public init(backend: any MeroAppBackend) {
        self.backend = backend
    }

    public func blob(id: String, contextId: String) async throws -> Data {
        try await backend.getBlob(blobId: id, contextId: contextId)
    }
}

/// No blobs: images are drawn as placeholders.
public struct NoBlobs: BlobLoading {
    public init() {}
    public func blob(id: String, contextId: String) async throws -> Data {
        throw URLError(.resourceUnavailable)
    }
}
