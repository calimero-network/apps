import Foundation
import MeroKit

/// What Mero Sign needs beyond ``MeroAppBackend``'s screens: blobs (a
/// document's PDF and every signed version, the signature images), group
/// metadata (the marker that says which workspace organization holds the
/// private store) and member names.
///
/// The app uses ``BackendSignAdmin``; tests use a fake.
public protocol SignAdmin: Sendable {
    /// Store bytes as a blob of an app instance the account reaches
    /// (`POST /apps/{app}/blobs`). Returns the blob id.
    func uploadBlob(_ data: Data, contextId: String) async throws -> String
    /// A blob's bytes, read through the context that holds it.
    func getBlob(_ blobId: String, contextId: String) async throws -> Data
    /// A group's metadata record: its name and data map, or nil if never set.
    func groupMetadata(_ groupId: String) async throws -> (name: String?, data: [String: String])?
    /// Replace a group's metadata record (name and data together).
    func setGroupMetadata(_ groupId: String, name: String?, data: [String: String]) async throws
    /// The name a member set for themselves in an organization (its member metadata).
    func memberName(namespaceId: String, account: String) async throws -> String?
}

/// ``SignAdmin`` over the account's ``MeroAppBackend`` (blobs, metadata reads,
/// member names) and, for the one write the backend has no call for (an
/// organization's metadata record WITH a data map, the private store's
/// marker), the signed-in ``CalimeroClient`` (`CloudAppBackend.client`).
public struct BackendSignAdmin: SignAdmin {
    public let backend: any MeroAppBackend
    public let client: CalimeroClient?

    public init(backend: any MeroAppBackend, client: CalimeroClient?) {
        self.backend = backend
        self.client = client
    }

    public func uploadBlob(_ data: Data, contextId: String) async throws -> String {
        try await backend.uploadBlob(contextId: contextId, data: data).blobId
    }

    public func getBlob(_ blobId: String, contextId: String) async throws -> Data {
        try await backend.getBlob(blobId: blobId, contextId: contextId)
    }

    public func groupMetadata(_ groupId: String) async throws -> (name: String?, data: [String: String])? {
        guard let record = try await backend.groupMetadata(groupId: groupId) else { return nil }
        return (record.name, record.data)
    }

    /// Sets `name` and `data`'s fields on the organization's metadata, keeping
    /// every other field: `package`, which says the organization is Mero
    /// Sign's, among them.
    public func setGroupMetadata(_ groupId: String, name: String?, data: [String: String]) async throws {
        guard let client else { throw SignModelError.message("You're signed out. Sign in again and retry.") }
        var fields = try await client.getOrg(groupId).metadata.objectValue ?? [:]
        if let name { fields["name"] = .string(name) }
        for (key, value) in data { fields[key] = .string(value) }
        try await client.setOrgMetadata(groupId, .object(fields))
    }

    public func memberName(namespaceId: String, account: String) async throws -> String? {
        try await backend.listMembers(groupId: namespaceId).first { SignIds.same($0.identity, account) }?.name
    }
}
