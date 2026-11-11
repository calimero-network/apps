import Foundation
import MeroKit

/// One app instance of Mero Sign the account reaches: an agreement (in a
/// workspace organization) or the account's signature library (in none).
public struct SignInstance: Hashable, Sendable {
    public let appId: String
    public let name: String
    /// The account that created it.
    public let owner: String
    /// The organization it is in; `nil` for an instance the account owns outright.
    public let org: String?

    public init(appId: String, name: String, owner: String, org: String?) {
        self.appId = appId
        self.name = name
        self.owner = owner
        self.org = org
    }
}

/// What Mero Sign needs beyond ``MeroAppBackend``'s screens, from the signed-in
/// ``CalimeroClient``, the same calls the web makes (`app/src/lib/agreements.ts`):
///
/// - blobs: a document's PDF and every signed version, the signature images
///   (`POST /apps/{app}/blobs` with their content type; the contract stores
///   the 64-hex id);
/// - this app's instances (`GET /apps?package=`) and creating the library
///   (`POST /apps`, in no org);
/// - member names (the org's member metadata).
///
/// The app uses ``ClientSignAdmin``; tests use a fake.
public protocol SignAdmin: Sendable {
    /// Store bytes as a blob of an app instance; returns its id as 64 lowercase hex.
    func uploadBlob(_ data: Data, contentType: String, contextId: String) async throws -> String
    /// A blob's bytes, read through the instance that holds it.
    func getBlob(_ blobId: String, contextId: String) async throws -> Data
    /// Mero Sign's instances the account reaches.
    func instances() async throws -> [SignInstance]
    /// Create an instance of Mero Sign named `name`, in `org` (or the account's own, in none). Returns its app id.
    func createInstance(name: String, org: String?) async throws -> String
    /// The name a member set for themselves in an organization (its member metadata).
    func memberName(namespaceId: String, account: String) async throws -> String?
}

/// ``SignAdmin`` over the signed-in ``CalimeroClient`` (blobs, instances) and
/// the account's ``MeroAppBackend`` (member names).
public struct ClientSignAdmin: SignAdmin {
    public let backend: any MeroAppBackend
    public let client: CalimeroClient?
    /// The app's package, or a bundle hash on a development cluster.
    public let applicationId: String

    public init(backend: any MeroAppBackend, client: CalimeroClient?, applicationId: String = SignConstants.packageName) {
        self.backend = backend
        self.client = client
        self.applicationId = applicationId
    }

    private func signedIn() throws -> CalimeroClient {
        guard let client else { throw SignModelError.message("You're signed out. Sign in again and retry.") }
        return client
    }

    private var isBundle: Bool { Hex.is32(applicationId) }

    public func uploadBlob(_ data: Data, contentType: String, contextId: String) async throws -> String {
        let blob = try await signedIn().uploadBlob(contextId, data, contentType: contentType)
        let id = SignIds.blobHex(blob.id)
        guard !id.isEmpty else { throw SignModelError.message("Your cluster returned a blob id this app can't use.") }
        return id
    }

    public func getBlob(_ blobId: String, contextId: String) async throws -> Data {
        try await signedIn().blobContent(contextId, blobId).data
    }

    public func instances() async throws -> [SignInstance] {
        let client = try signedIn()
        let bundle: String? = isBundle ? applicationId : nil
        let package: String? = isBundle ? nil : applicationId
        let apps = try await client.answer(as: AppListing.self) {
            try await client.apps.list(package: package, bundle: bundle)
        }.apps
        return apps.map { SignInstance(appId: $0.appId, name: $0.name, owner: $0.owner, org: $0.org) }
    }

    public func createInstance(name: String, org: String?) async throws -> String {
        let client = try signedIn()
        let bundle: String? = isBundle ? applicationId : nil
        let package: String? = isBundle ? nil : applicationId
        let created = try await client.answerJSON {
            try await client.apps.create(name: name, bundle: bundle, package: package, org: org)
        }
        guard let appId = created["appId"]?.stringValue else {
            throw SignModelError.message("The cluster created no app.")
        }
        return appId
    }

    public func memberName(namespaceId: String, account: String) async throws -> String? {
        try await backend.listMembers(groupId: namespaceId).first { SignIds.same($0.identity, account) }?.name
    }
}

/// `GET /apps`' answer, read as MeroKit's ``AppInfo``.
private struct AppListing: Decodable {
    let apps: [AppInfo]
}
