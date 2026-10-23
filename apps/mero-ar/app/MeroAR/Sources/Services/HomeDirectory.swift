import Foundation
import MeroKit

/// A home: one Calimero namespace running Mero AR, holding rooms (its
/// contexts). People are invited to a home and can then open every room in it.
public struct Home: Identifiable, Equatable {
    /// The namespace id.
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

/// What a home listing found: the homes, and rooms of this app that sit in
/// no home this session can see (rooms a node made before homes existed).
public struct HomeListing: Equatable {
    public var homes: [Home]
    public var looseRooms: [RoomSummary]

    public init(homes: [Home], looseRooms: [RoomSummary] = []) { self.homes = homes; self.looseRooms = looseRooms }
}

/// A home just founded.
public struct CreatedHome: Equatable {
    public let id: String
    /// Why Calimero Cloud isn't hosting it, when it isn't: people with no node
    /// of their own may not be able to join until it is.
    public let hostingNote: String?
}

/// Listing, founding, filling and inviting to homes as the signed-in session.
/// ``CloudHomes`` on a Calimero Cloud session, ``NodeHomes`` on a node.
public protocol HomeDirectory: Sendable {
    func list() async throws -> HomeListing
    func createHome(named name: String) async throws -> CreatedHome
    /// Create a room in `homeId`; returns the room's context id.
    func createRoom(named name: String, inHome homeId: String) async throws -> String
    /// A signed invitation to the home (no room in particular).
    func invite(toHome homeId: String, homeName: String) async throws -> RoomInvite
}

// MARK: - Calimero Cloud

/// Homes through the account's relay, the way Mero Tag founds spaces:
///
/// - **List**: the relay's caller-scoped namespace listing, filtered to Mero
///   AR's application, then each namespace's contexts.
/// - **Create a home**: ``CloudSignIn/foundNamespace(_:name:package:application:defaultCapabilities:registryURL:)``,
///   which founds the namespace as the account, sets Mero AR as its
///   application and asks the cloud to host it (HA).
/// - **Create a room**: ``RelayClient/createContext(groupId:applicationId:initArgs:serviceName:name:seed:)``
///   in the namespace, signed by this device.
/// - **Invite**: a namespace invitation signed by this device.
public struct CloudHomes: HomeDirectory {
    public let cloud: CloudSignIn
    public let connection: CloudConnection
    public var registryURL = AppState.registry
    public var urlSession: URLSession = .shared

    public init(cloud: CloudSignIn, connection: CloudConnection, urlSession: URLSession = .shared) {
        self.cloud = cloud
        self.connection = connection
        self.urlSession = urlSession
    }

    /// Mero AR's application id: `sha256(package, signer)`, the same for every
    /// version, so it matches homes founded on older releases too.
    private func application() async throws -> FoundingApplication {
        let resolved = try await ApplicationRegistry.resolve(
            registryURL: registryURL, package: AppState.package, session: urlSession)
        return FoundingApplication(
            applicationId: resolved.applicationId, package: AppState.package, version: resolved.version)
    }

    public func list() async throws -> HomeListing {
        guard connection.relay != nil else { throw MeroARError.noRelay }
        guard let mero = connection.mero else { throw MeroARError.readsUnavailable }
        let appId = try await application().applicationId
        let namespaces = try await mero.admin.listNamespaces().filter { $0.targetApplicationId == appId }
        var homes: [Home] = []
        for namespace in namespaces {
            homes.append(await Self.home(namespace, admin: mero.admin, transport: connection.relay.map { RelayTransport(relay: $0) }))
        }
        return HomeListing(homes: homes)
    }

    /// One namespace and its rooms. A room the listing left unnamed asks the
    /// room itself (`get_room`).
    static func home(_ namespace: Namespace, admin: AdminApi, transport: ContractTransport?) async -> Home {
        var home = Home(
            id: namespace.namespaceId, name: namespace.name ?? "", memberCount: namespace.memberCount)
        do {
            for entry in try await admin.listGroupContexts(namespace.namespaceId) {
                var name = entry.name ?? ""
                var info: RoomInfo?
                if let transport {
                    info = try? await transport.query(RoomInfo.self, contextId: entry.contextId, method: "get_room")
                    if name.isEmpty { name = info?.name ?? "" }
                }
                home.rooms.append(
                    RoomSummary(
                        id: entry.contextId, name: name, objectCount: info?.objectCount,
                        memberCount: info?.memberCount))
            }
        } catch {
            home.roomsError = userMessage(error)
        }
        return home
    }

    public func createHome(named name: String) async throws -> CreatedHome {
        guard connection.relay != nil else { throw MeroARError.noRelay }
        let founded = try await cloud.foundNamespace(
            connection, name: name, package: AppState.package, application: try await application())
        return CreatedHome(id: founded.namespaceId, hostingNote: founded.haEnabled ? nil : (founded.haError ?? ""))
    }

    public func createRoom(named name: String, inHome homeId: String) async throws -> String {
        guard let relay = connection.relay else { throw MeroARError.noRelay }
        let created = try await relay.createContext(
            groupId: homeId, applicationId: try await application().applicationId,
            initArgs: .object(["name": .string(name)]), name: name)
        return created.contextId
    }

    public func invite(toHome homeId: String, homeName: String) async throws -> RoomInvite {
        let signed = try await cloud.createNamespaceInvitation(connection, namespaceId: homeId)
        return RoomInvite(namespaceId: homeId, contextId: "", roomName: "", homeName: homeName, invitation: signed)
    }
}

// MARK: - A node

/// Homes on a node the person signed in to with its admin credentials: the
/// node's own namespaces running Mero AR, installed from the registry the
/// first time.
public struct NodeHomes: HomeDirectory {
    public let mero: Mero
    public let nodeURL: String

    public init(mero: Mero, nodeURL: String) {
        self.mero = mero
        self.nodeURL = nodeURL
    }

    private var transport: NodeTransport { NodeTransport(mero: mero, nodeURL: nodeURL) }

    /// Every install of Mero AR on the node (a dev bundle and a registry
    /// install can sit side by side). Throws when the node can't list its
    /// apps, rather than reading that as "not installed".
    private func appIds() async throws -> [String] {
        try await mero.admin.listApplications().apps.filter { $0.package == AppState.package }.map(\.id)
    }

    /// The rooms are the node's contexts running Mero AR; failing to list
    /// those is the listing failing. Sorting them into homes is best effort: a
    /// room whose namespace can't be told stays listed, as a loose room.
    public func list() async throws -> HomeListing {
        let ids = Set(try await appIds())
        guard !ids.isEmpty else { return HomeListing(homes: []) }
        let contexts = try await mero.admin.getContexts().contexts.filter { ids.contains($0.applicationId) }
        let namespaces = ((try? await mero.admin.listNamespaces()) ?? []).filter {
            ids.contains($0.targetApplicationId)
        }

        // Group id → namespace id, for rooms made in a subgroup.
        var owner: [String: String] = [:]
        for namespace in namespaces {
            owner[namespace.namespaceId] = namespace.namespaceId
            for group in (try? await mero.admin.listNamespaceGroups(namespace.namespaceId)) ?? [] {
                owner[group.groupId] = namespace.namespaceId
            }
        }
        var homes = namespaces.map { Home(id: $0.namespaceId, name: $0.name ?? "", memberCount: $0.memberCount) }
        var loose: [RoomSummary] = []
        for context in contexts {
            let info = try? await transport.query(RoomInfo.self, contextId: context.id, method: "get_room")
            let room = RoomSummary(
                id: context.id, name: info?.name ?? "", objectCount: info?.objectCount, memberCount: info?.memberCount)
            let group = (try? await mero.admin.getContextGroup(context.id)) ?? nil
            if let home = group.flatMap({ owner[$0] }), let index = homes.firstIndex(where: { $0.id == home }) {
                homes[index].rooms.append(room)
            } else {
                loose.append(room)
            }
        }
        return HomeListing(homes: homes, looseRooms: loose)
    }

    public func createHome(named name: String) async throws -> CreatedHome {
        let appId = try await installedApp()
        let namespace = try await mero.admin.createNamespace(CreateNamespaceRequest(applicationId: appId, name: name))
        return CreatedHome(id: namespace.namespaceId, hostingNote: nil)
    }

    public func createRoom(named name: String, inHome homeId: String) async throws -> String {
        let namespace = try await mero.admin.getNamespace(homeId)
        let params = try JSONSerialization.data(withJSONObject: ["name": name])
        let context = try await mero.admin.createContext(
            CreateContextRequest(
                applicationId: namespace.targetApplicationId, groupId: homeId,
                initializationParams: params.map { Int($0) }, name: name))
        return context.contextId
    }

    public func invite(toHome homeId: String, homeName: String) async throws -> RoomInvite {
        let signed = try await MeroARService.nodeMinter(mero)(homeId)
        return RoomInvite(namespaceId: homeId, contextId: "", roomName: "", homeName: homeName, invitation: signed)
    }

    /// Mero AR's application on the node, installing it from the registry the
    /// first time (or a local dev bundle, `MEROAR_APP_BUNDLE`, for a contract
    /// newer than the registry's).
    private func installedApp() async throws -> String {
        if let bundle = ProcessInfo.processInfo.environment["MEROAR_APP_BUNDLE"], !bundle.isEmpty {
            return try await mero.admin.installDevApplication(InstallDevApplicationRequest(path: bundle)).applicationId
        }
        if let installed = try await appIds().last { return installed }
        guard
            let version = try await mero.admin.getRegistryVersions(
                registryUrl: AppState.registry, packageName: AppState.package
            ).first
        else { throw MeroError.decoding("\(AppState.package) is not on the app registry") }
        return try await mero.admin.installFromRegistry(packageName: AppState.package, version: version).applicationId
    }
}
