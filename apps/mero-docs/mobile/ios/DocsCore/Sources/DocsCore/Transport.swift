import Foundation
import MeroKit
import MeroKitUI

/// One folder's docs instance: the typed client, plus the lenient body read
/// (see ``DocsAPI/readDocument(_:)``).
public struct DocsAPI: Sendable {
    public let client: DocsClient
    /// The contract under `client`, for the one read the app decodes itself.
    let transport: any ContextContractCalling

    public init(transport: any ContextContractCalling) {
        self.client = DocsClient(contract: transport)
        self.transport = transport
    }

    /// The document's body as blocks, in order.
    ///
    /// `getDocument` is decoded leniently: each block's text is its spans, in
    /// order, each with its marks as strings (`"true"` for a boolean mark, as
    /// the web's `canonicalAttrs` reads them). A mark the node writes as a JSON
    /// boolean, or a span without `attributes`, is read the same way. So it is
    /// read off the contract directly: the generated client reads `Block` strictly.
    public func readDocument(_ docId: String) async throws -> [WireBlock] {
        let args = try MeroJSON.encode(JSONValue.object(["doc": .string(docId)]))
        let data = try await transport.query(method: "getDocument", argsJSON: args)
        return try JSONDecoder().decode([WireBlock]?.self, from: data) ?? []
    }
}

extension MeroAppBackend {
    /// The docs contract of the folder's app instance `appId`.
    public func docs(_ appId: String) -> DocsAPI {
        DocsAPI(transport: contract.bound(to: appId))
    }
}

// MARK: - Folders

/// A workspace's folders, read as the web reads them (`lib/coreFolders.ts`).
///
/// On Calimero 1.0 (``CalimeroAppBackend``) a workspace is an organization and
/// a folder one of its teams: the team's name, its `parent`, and the folder's
/// docs instance, whose id the team metadata keeps as `docsApp`. One
/// `GET /orgs/{org}` answers all of it, with only the teams the caller reaches.
/// Any other backend (the demo, tests) is walked through `listSubgroups`, each
/// folder's first app instance being its docs instance.
public struct DocsDirectory: Sendable {
    /// Where a folder's docs instance id is kept in its team's metadata.
    public static let docsAppKey = "docsApp"

    let backend: any MeroAppBackend

    public init(backend: any MeroAppBackend) { self.backend = backend }

    /// How deep a walked folder tree goes.
    public static let maxDepth = 8

    /// Every folder of `workspaceId` this account sees.
    public func folders(workspaceId: String) async throws -> [Folder] {
        if let cloud = backend as? CalimeroAppBackend {
            let client = cloud.client
            let answer = try await client.orgs.get(org: workspaceId)
            let org = OrgInfo(json: try MeroJSON.decode(JSONValue.self, from: MeroJSON.encode(answer)))
            return Self.folders(of: org)
        }
        return try await walk(workspaceId)
    }

    /// The docs instance of one folder, when a link did not carry it.
    public func docsApp(workspaceId: String, folderId: String) async throws -> String? {
        if let cloud = backend as? CalimeroAppBackend {
            let client = cloud.client
            let answer = try await client.orgs.get(org: workspaceId)
            let org = OrgInfo(json: try MeroJSON.decode(JSONValue.self, from: MeroJSON.encode(answer)))
            return org.teams[folderId].flatMap(Self.docsApp)
        }
        return try await backend.listContexts(groupId: folderId).first
    }

    /// The folders of one org snapshot: a team whose parent the caller cannot
    /// see sits at the top, as the web's Shared folders do.
    public static func folders(of org: OrgInfo) -> [Folder] {
        org.teams.values.map { team in
            let parent = team.parent.flatMap { org.teams[$0] == nil ? nil : $0 }
            return Folder(
                id: team.teamId, name: team.name.trimmed.nonEmpty ?? "Untitled folder", parentId: parent,
                contextId: docsApp(team))
        }
        .sorted { $0.id < $1.id }
    }

    static func docsApp(_ team: OrgInfo.Team) -> String? {
        team.metadata.objectValue?[docsAppKey]?.stringValue?.nonEmpty
    }

    /// The tree, one level at a time from the workspace. A level that cannot
    /// be read is left empty; only the top failing fails the load.
    private func walk(_ workspaceId: String) async throws -> [Folder] {
        let backend = backend
        var found: [Folder] = []
        var seen: Set<String> = [workspaceId]
        let top = try await backend.listSubgroups(namespaceId: workspaceId)
        var level: [(AppSubgroup, String?)] = top.map { ($0, nil) }
        var depth = 0
        while !level.isEmpty && depth < Self.maxDepth {
            var next: [String] = []
            for (sg, parent) in level where seen.insert(sg.groupId).inserted {
                found.append(
                    Folder(
                        id: sg.groupId, name: sg.name?.trimmed.nonEmpty ?? "Untitled folder", parentId: parent,
                        contextId: sg.contextIds.first))
                next.append(sg.groupId)
            }
            let children = await withTaskGroup(of: [(AppSubgroup, String?)].self) { group in
                for id in next {
                    group.addTask { ((try? await backend.listSubgroups(namespaceId: id)) ?? []).map { ($0, id) } }
                }
                var out: [(AppSubgroup, String?)] = []
                for await list in group { out += list }
                return out
            }
            level = children.sorted { $0.0.groupId < $1.0.groupId }
            depth += 1
        }
        return found
    }
}

/// Image bytes stored as blobs on the folder's docs app instance, read through
/// `MeroAppBackend.getBlob` (`/apps/{app}/blobs` on Calimero 1.0).
public protocol BlobLoading: Sendable {
    func blob(id: String, contextId: String) async throws -> Data
}

/// No blobs: images show as unavailable.
public struct NoBlobs: BlobLoading {
    public init() {}
    public func blob(id: String, contextId: String) async throws -> Data {
        throw URLError(.resourceUnavailable)
    }
}
