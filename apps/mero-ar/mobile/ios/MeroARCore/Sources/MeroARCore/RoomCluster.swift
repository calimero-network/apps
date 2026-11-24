import Foundation
import MeroKit

/// A home: one Calimero organization running Mero AR, holding rooms (its app
/// instances). People are invited to a home and can then open every room in it.
/// A room in the lobby's list.
public struct RoomSummary: Identifiable, Equatable, Codable {
    public let id: String
    public var name: String
    public var lastOpened: Date?
    public var objectCount: Int?
    public var memberCount: Int?

    public init(id: String, name: String, lastOpened: Date? = nil, objectCount: Int? = nil, memberCount: Int? = nil) {
        self.id = id; self.name = name; self.lastOpened = lastOpened; self.objectCount = objectCount
        self.memberCount = memberCount
    }
}

public struct Home: Identifiable, Equatable {
    /// The organization id.
    public let id: String
    public var name: String
    public var memberCount: Int?
    public var rooms: [RoomSummary]
    /// Why the rooms couldn't be listed, when they couldn't. The home is still
    /// shown, so a failure never reads as "no rooms in this home".
    public var roomsError: String?

    public init(id: String, name: String, memberCount: Int? = nil, rooms: [RoomSummary] = [], roomsError: String? = nil) {
        self.id = id; self.name = name; self.memberCount = memberCount; self.rooms = rooms; self.roomsError = roomsError
    }
}

/// What a home listing found: the homes, and Mero AR rooms this account can
/// reach that belong to no organization.
public struct HomeListing: Equatable {
    public var homes: [Home]
    public var looseRooms: [RoomSummary]

    public init(homes: [Home], looseRooms: [RoomSummary] = []) { self.homes = homes; self.looseRooms = looseRooms }
}

/// Everything Mero AR asks of a Calimero 1.0 cluster, as the signed-in account.
///
/// ``CloudCluster`` speaks to a real cluster through the SDK's
/// ``CalimeroClient`` (sealed channel, passkey session). Debug builds also
/// have an in-memory one for tests and UI tests (`FixtureCluster`).
///
/// The vocabulary maps one to one:
/// - a **home** is an organization (`POST /orgs`, metadata `{name, package}`);
/// - a **room** is an app instance of `com.calimero.mero-ar` in that
///   organization, reachable by its members (`POST /apps`, access `org`);
/// - an **invitation** is an org invite token (`POST /orgs/{org}/invites`),
///   redeemed with `POST /invites/{token}/redeem`;
/// - contract calls are `intents`, reads are `views`, live changes are the
///   app's sealed SSE `events`, and blobs live with the app instance.
public protocol RoomCluster: Sendable {
    /// Where calls go, for the technical details.
    var endpoint: String { get }

    /// A read-only contract method. `nil` for `()` / `None`.
    func view(app: String, method: String, args: [String: JSONValue]) async throws -> JSONValue?
    /// A contract method that writes; answers what it returned.
    @discardableResult
    func call(app: String, method: String, args: [String: JSONValue]) async throws -> JSONValue?
    /// The app's committed events, then live ones.
    func events(app: String) -> AsyncThrowingStream<CloudEvent, Error>
    /// Upload bytes to the app's blobs; answers the id the contract stores.
    func uploadBlob(app: String, data: Data) async throws -> String
    func downloadBlob(app: String, id: String) async throws -> Data

    func listHomes() async throws -> HomeListing
    /// Found a home; answers the organization id.
    func createHome(named name: String) async throws -> String
    /// Create a room in a home; answers the app id.
    func createRoom(named name: String, inHome homeId: String) async throws -> String
    /// The organization a room belongs to, if any.
    func home(ofRoom app: String) async throws -> String?
    /// The organization's display name.
    func homeName(_ homeId: String) async throws -> String
    /// A single-use-per-person invite token to a home.
    func invite(toHome homeId: String) async throws -> String
    /// Redeem an invite token as the signed-in account.
    func redeem(token: String) async throws

    /// The version a room runs and the newest published one, when they differ.
    func availableUpdate(app: String) async throws -> RoomUpdate?
}

/// A newer release of Mero AR that a room could run.
public struct RoomUpdate: Equatable, Sendable {
    public let current: String
    public let latest: String

    public init(current: String, latest: String) {
        self.current = current
        self.latest = latest
    }
}

extension RoomCluster {
    func view<T: Decodable>(_ type: T.Type, app: String, method: String, args: [String: JSONValue] = [:])
        async throws -> T
    {
        let value = try await view(app: app, method: method, args: args) ?? .null
        return try MeroJSON.decode(T.self, from: try MeroJSON.encode(value))
    }
}

// MARK: - A Calimero 1.0 cluster

/// Asks the node's consent page for `request` (built with the page's
/// `returnTo`) and answers the decision.
public typealias ConsentDecider =
    @Sendable @MainActor (_ request: @escaping (_ returnTo: String) -> ConsentRequest) async throws -> ConsentResult

/// The cluster behind the signed-in ``CalimeroClient``.
public struct CloudCluster: RoomCluster {
    public let client: CalimeroClient
    public let package: String
    /// The passkey for this account's step-ups; minting an invite on a
    /// development node is one.
    public let passkey: (any PasskeyProvider)?
    /// The node this session signed in to.
    public let endpoint: String
    /// The node's consent page, for a session bound to Mero AR's package (a
    /// Calimero Cloud sign-in on the served page): the node refuses such a
    /// session organization routes, so founding a home, inviting and joining
    /// are approved there. `nil`: the session does them itself.
    public let consent: ConsentDecider?

    public init(
        client: CalimeroClient, passkey: (any PasskeyProvider)?, endpoint: String,
        package: String = MeroARPackage.id, consent: ConsentDecider? = nil
    ) {
        self.client = client
        self.passkey = passkey
        self.endpoint = endpoint
        self.package = package
        self.consent = consent
    }

    /// `request` approved on the consent page, or ``MeroARError/declined``.
    private func approved(_ consent: ConsentDecider, _ request: @escaping (String) -> ConsentRequest)
        async throws -> ConsentResult
    {
        let result = try await consent(request)
        guard result.isApproved else { throw MeroARError.declined }
        return result
    }

    public func view(app: String, method: String, args: [String: JSONValue]) async throws -> JSONValue? {
        try await client.view(app, method, .object(args)).result.flatMap { $0 == .null ? nil : $0 }
    }

    @discardableResult
    public func call(app: String, method: String, args: [String: JSONValue]) async throws -> JSONValue? {
        try await client.call(app, method, .object(args)).result.flatMap { $0 == .null ? nil : $0 }
    }

    public func events(app: String) -> AsyncThrowingStream<CloudEvent, Error> { client.events(app) }

    public func uploadBlob(app: String, data: Data) async throws -> String {
        try await client.apps.blobUpload(app: app, body: data).blobId
    }

    public func downloadBlob(app: String, id: String) async throws -> Data {
        try await client.apps.blobDownload(app: app, id: id)
    }

    /// The account's organizations that hold Mero AR (by metadata, or by
    /// running a room of it), each with its rooms.
    public func listHomes() async throws -> HomeListing {
        let me = AccountInfo(json: try JSONValue(encoding: try await client.auth.me()))
        let apps = try MeroJSON.convert(try await client.apps.list(package: package).apps, to: [AppInfo].self)
        var homes: [Home] = []
        for membership in me.orgs {
            let rooms = apps.filter { $0.org == membership.orgId }
            do {
                let org = try await org(membership.orgId)
                guard org.metadata["package"]?.stringValue == package || !rooms.isEmpty else { continue }
                homes.append(
                    Home(
                        id: org.orgId, name: org.metadata["name"]?.stringValue ?? org.name,
                        memberCount: org.members.count, rooms: rooms.map(Self.summary)))
            } catch {
                guard !rooms.isEmpty else { continue }
                homes.append(
                    Home(id: membership.orgId, name: membership.name, rooms: rooms.map(Self.summary),
                         roomsError: userMessage(error)))
            }
        }
        let known = Set(me.orgs.map(\.orgId))
        let loose = apps.filter { $0.org.map { !known.contains($0) } ?? true }.map(Self.summary)
        return HomeListing(homes: homes, looseRooms: loose)
    }

    static func summary(_ app: AppInfo) -> RoomSummary {
        RoomSummary(id: app.appId, name: app.name, lastOpened: nil)
    }

    private func org(_ id: String) async throws -> OrgInfo {
        OrgInfo(json: try JSONValue(encoding: try await client.orgs.get(org: id)))
    }

    private func app(_ id: String) async throws -> JSONValue {
        try JSONValue(encoding: try await client.apps.get(app: id))
    }

    public func createHome(named name: String) async throws -> String {
        let org: String
        if let consent {
            guard let made = try await approved(consent, { .createOrg(name: name, returnTo: $0) }).orgId else {
                throw MeroARError.declined
            }
            org = made
        } else {
            org = try await client.orgs.create(name: name).orgId
        }
        // `POST /orgs/{org}/metadata`, which any member may set (a
        // package-bound session too): how the lobby knows a home.
        _ = try await client.post(
            "orgs/\(org)/metadata", ["metadata": ["name": .string(name), "package": .string(package)]])
        return org
    }

    public func createRoom(named name: String, inHome homeId: String) async throws -> String {
        // `POST /apps`: a package-bound session creates instances of its own package only.
        let created = try await client.post(
            "apps",
            [
                "name": .string(name), "package": .string(package), "org": .string(homeId),
                "access": ["kind": "org"], "initArgs": ["name": .string(name)],
            ])
        guard let appId = created["appId"]?.stringValue else {
            throw AccountError.protocolViolation("the cluster answered no app id")
        }
        return appId
    }

    public func home(ofRoom app: String) async throws -> String? {
        try await self.app(app)["org"]?.stringValue
    }

    public func homeName(_ homeId: String) async throws -> String {
        let org = try await org(homeId)
        return org.metadata["name"]?.stringValue ?? org.name
    }

    public func invite(toHome homeId: String) async throws -> String {
        if let consent {
            let made = try await approved(consent) { .createInvite(org: homeId, role: .member, returnTo: $0) }
            guard let token = made.inviteToken else { throw MeroARError.declined }
            return token
        }
        guard let passkey else { throw MeroARError.notSignedIn }
        return try await client.orgs.inviteCreate(org: homeId, role: .member, teams: [], passkey: passkey).token
    }

    public func redeem(token: String) async throws {
        if let consent {
            _ = try await approved(consent) { .acceptInvite(token: token, returnTo: $0) }
            return
        }
        _ = try await client.orgs.inviteRedeem(token: token)
    }

    public func availableUpdate(app: String) async throws -> RoomUpdate? {
        guard let current = try await self.app(app)["version"]?.stringValue,
            case let latest = try await client.packages.get(package: package).latest, latest != current
        else { return nil }
        return RoomUpdate(current: current, latest: latest)
    }
}

// MARK: - Errors

public enum MeroARError: LocalizedError, Equatable {
    /// Not signed in to a cluster.
    case notSignedIn
    /// The invitation was redeemed but the room isn't reachable yet.
    case roomNotSynced
    /// The invitation was redeemed but the home never listed.
    case homeNotSynced
    case invitationRefused(String)
    /// The request was declined on the approval page.
    case declined
    /// The approval page couldn't be asked, or its answer not read.
    case consentUnavailable(String)

    public var errorDescription: String? {
        switch self {
        case .notSignedIn:
            return "Sign in to your Calimero cluster first."
        case .roomNotSynced:
            return "You joined, but the room isn't reachable yet. Try again in a moment."
        case .homeNotSynced:
            return "You joined the home, but it isn't listed yet. Pull to refresh in a moment."
        case .invitationRefused(let reason):
            return "This invitation wasn't accepted: \(reason)"
        case .declined:
            return "That wasn't approved."
        case .consentUnavailable(let reason):
            return reason
        }
    }
}

/// The contract's own sentence for a refused call ("view-only: …"), else the
/// cluster's, in words for a person.
public func userMessage(_ error: Error) -> String {
    switch error {
    case let error as AppError:
        // The contract's `Forbidden` / `Invalid` carry their sentence in a
        // `message` field (`{ code, fields: { message } }` on the wire).
        if let sentence = error.fields["message"]?.stringValue, !sentence.isEmpty { return sentence }
        return error.message.isEmpty ? error.appCode : error.message
    case is LoginRequired:
        return "Your session ended. Sign in again."
    case is WrongNode:
        return "This node may not serve your account. Try another node of your cluster."
    case let error as UnavailableError:
        return "The cluster is unavailable right now (\(error.reason)). Try again shortly."
    case is NotFound:
        return "That room or home isn't there, or your account can't reach it."
    case let error as CalimeroError:
        return error.message.isEmpty ? error.code : error.message
    case let error as TeeTrustError:
        return "The node could not be verified: \(error.message)"
    default:
        if let urlError = error as? URLError { return "Can't reach the cluster (\(urlError.code.rawValue))." }
        return (error as? LocalizedError)?.errorDescription ?? "Something went wrong."
    }
}

// `JSONValue(encoding:)`, a `Codable` model as the SDK's dynamic JSON (key
// names kept as they are), is MeroKit's own.
