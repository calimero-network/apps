import MeroKit
import SwiftUI
import UIKit
import XCTest

@testable import MeroChat

/// Every screen, drawn with sample data in a real window, light and dark.
///
/// By default this checks that each screen lays out and draws. With
/// `TEST_RUNNER_MERO_SNAPSHOT_DIR` set, it also writes each one as a PNG
/// there, to compare against the web app at phone width.
@MainActor
final class ScreenSnapshotTests: XCTestCase {
    private let size = CGSize(width: 390, height: 844)

    func testTheSidebarDraws() async throws {
        let (channels, workspaces) = try await sidebarModels()
        try await snapshot("sidebar") {
            SidebarView(
                model: channels, workspaces: workspaces, workspace: SnapshotData.workspace,
                current: channels.channels.first { $0.name == "launch-planning" }, browsing: false,
                onOpen: { _ in }, onBrowse: {}, onCreateChannel: {}, onSwitchWorkspace: { _ in }, onNewWorkspace: {})
        }
    }

    func testTheChannelDraws() async throws {
        let model = channelModel()
        await model.loadInitial()
        let session = SessionModel()
        try await snapshot("channel") {
            VStack(spacing: 0) {
                NavBar(onBack: {}) {
                    HStack(spacing: 6) {
                        Image(systemName: "number").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.muted)
                        Text("launch-planning").font(Theme.font(16, .semibold)).foregroundStyle(Theme.ink)
                        Image(systemName: "gearshape.fill").font(.system(size: 11)).foregroundStyle(Theme.muted)
                    }
                } trailing: {
                    NavIconButton(systemImage: "magnifyingglass", label: "Search", tint: Theme.ink2) {}
                    NavIconButton(systemImage: "plus", label: "Invite") {}
                    NavIconButton(systemImage: "moon", label: "Theme") {}
                    NavIconButton(systemImage: "gearshape", label: "Settings") {}
                }
                ConversationView(model: model, session: session, onOpenThread: { _ in }, onShowReactions: { _ in })
            }
            .background(GroundBackground())
        }
    }

    func testTheLandingAndPickerDraw() async throws {
        let session = SessionModel()
        try await snapshot("landing") { SignInView(session: session, client: session.client) }
        let (_, workspaces) = try await sidebarModels()
        try await snapshot("picker") { WorkspacePicker(session: session, model: workspaces) { _ in } }
    }

    func testTheDialogsDraw() async throws {
        let (channels, _) = try await sidebarModels()
        try await snapshot("create-channel") { CreateChannelDialog(model: channels) {} }
        let session = SessionModel()
        try await snapshot("settings") {
            SettingsDialog(
                session: session, workspace: SnapshotData.workspace, channelRole: .admin, onChangeWorkspace: {},
                onClose: {})
        }
    }

    // MARK: Rig

    private func sidebarModels() async throws -> (ChannelsModel, WorkspacesModel) {
        let backend = SnapshotBackend()
        let channels = ChannelsModel(workspace: SnapshotData.workspace, backend: backend, displayName: { "Ada Mensah" })
        await channels.load()
        let workspaces = WorkspacesModel(backend: backend, applicationId: { nil }, displayName: { "Ada Mensah" })
        await workspaces.load()
        XCTAssertFalse(channels.channels.isEmpty)
        return (channels, workspaces)
    }

    private func channelModel() -> ChannelModel {
        let entry = ChannelEntry(
            id: "ctx-launch", groupId: "g-launch", name: "launch-planning", kind: .channel, isJoined: true, unread: 0)
        return ChannelModel(channel: entry, backend: SnapshotBackend(), pollInterval: 3600)
    }

    private func snapshot(_ name: String, @ViewBuilder _ view: () -> some View) async throws {
        for scheme in [ColorScheme.light, .dark] {
            let host = UIHostingController(rootView: view().environment(\.colorScheme, scheme))
            host.overrideUserInterfaceStyle = scheme == .dark ? .dark : .light
            let scene = try XCTUnwrap(
                UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first,
                "the host app has a window scene")
            let window = UIWindow(windowScene: scene)
            window.frame = CGRect(origin: .zero, size: size)
            window.overrideUserInterfaceStyle = host.overrideUserInterfaceStyle
            window.rootViewController = host
            window.makeKeyAndVisible()
            host.view.frame = window.bounds
            host.view.layoutIfNeeded()
            try await Task.sleep(nanoseconds: 400_000_000)
            let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
                window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
            }
            XCTAssertEqual(image.size, size, name)
            if let dir = ProcessInfo.processInfo.environment["MERO_SNAPSHOT_DIR"], let png = image.pngData() {
                let url = URL(fileURLWithPath: dir).appendingPathComponent("\(name)-\(scheme == .dark ? "dark" : "light").png")
                try png.write(to: url)
            }
            window.isHidden = true
        }
    }
}

// MARK: - Sample data

enum SnapshotData {
    static let workspace = Workspace(id: String(repeating: "ab", count: 32), name: "Northwind Labs", applicationId: "app")
    static let me = ChatIdentity.userId(accountHex: SnapshotBackend.accountHex) ?? ""
    static let people = [
        "AdaId111111111111111111111111111111111111111": "Ada Mensah",
        "PriyaId11111111111111111111111111111111111111": "Priya Nair",
        "JonasId11111111111111111111111111111111111111": "Jonas Ekberg",
        "TheoId111111111111111111111111111111111111111": "Theo Brandt",
    ]

    static func id(_ name: String) -> String { people.first { $0.value == name }?.key ?? me }

    static let messages: [(String, String, String, Int)] = [
        ("Theo Brandt", "<p>Launch moves to <strong>Tuesday</strong>. Legal signed off on the privacy page.</p>", "{\"👍\":[\"A\",\"B\",\"C\",\"D\"],\"👀\":[\"A\"]}", 5),
        ("Ada Mensah", "<p>Tuesday is fine for design. I'll move the social posts and the blog header to match.</p>", "null", 0),
        ("Priya Nair", "<p>Great. I've updated the launch checklist: <a href=\"https://notes.northwind.example/launch-2-0\">https://notes.northwind.example/launch-2-0</a></p>", "null", 0),
        ("Jonas Ekberg", "<p>Support is staffed for Tuesday and Wednesday. I'll post the on-call rota here tomorrow.</p>", "{\"🙏\":[\"A\",\"B\"]}", 0),
        ("Theo Brandt", "<p>RC1 is building now, <span class=\"mention mention-user-ada\">@Ada Mensah</span>. I'll share the TestFlight link once it's through processing.</p>", "null", 0),
        ("me", "<p>Thanks all!</p><ul><li><p>copy is final</p></li><li><p>press list is out</p></li></ul>", "{\"🎉\":[\"ME\"]}", 0),
    ]

    static func pageJSON() -> String {
        let now = UInt64(Date().timeIntervalSince1970)
        let items = messages.enumerated().map { i, m -> String in
            let sender = m.0 == "me" ? me : id(m.0)
            let reactions = m.2.replacingOccurrences(of: "\"ME\"", with: "\"\(me)\"")
            let text = m.1.replacingOccurrences(of: "\"", with: "\\\"")
            let edited = i == 2 ? "\(now - 100)" : "null"
            return """
                {"index":\(i),"timestamp":\(now - 3000 + UInt64(i) * 400),"sender":"\(sender)","mentions":[],\
                "mentions_usernames":[],"files":[],"images":[],"id":"m\(i)","text":"\(text)","edited_on":\(edited),\
                "reactions":\(reactions),"deleted":null,"thread_count":\(m.3),"thread_last_timestamp":\(m.3 > 0 ? now - 2220 : 0),\
                "parent_message_id":null}
                """
        }
        return #"{"total_count":\#(messages.count),"messages":[\#(items.joined(separator: ","))],"start_position":0}"#
    }

    static func profilesJSON() -> String {
        let all = people.map { #"{"identity":"\#($0.key)","username":"\#($0.value)","avatar":null}"# }
            + [#"{"identity":"\#(me)","username":"Fran","avatar":null}"#]
        return "[\(all.joined(separator: ","))]"
    }
}

/// A backend answering from ``SnapshotData``.
final class SnapshotBackend: ChatBackend, @unchecked Sendable {
    static let accountHex = "96c8a97ab268d076ed1f662138b330b2edff5a4159775eca4a383b3e5918f3e4"
    let account = SnapshotBackend.accountHex
    let contract: any ChatContract = SnapshotContract()
    let hasRelay = true
    let canSubscribe = false

    fileprivate static let channels: [(String, Bool, Int, Int)] = [
        ("design", false, 1, 1), ("engineering", false, 0, 0), ("general", false, 3, 0),
        ("launch-planning", false, 0, 0), ("leadership", true, 0, 0), ("random", false, 0, 0),
    ]
    fileprivate static let dms: [(String, Int)] = [("Theo Brandt", 2), ("Priya Nair", 0), ("Sam Whitfield", 0), ("Lena Kovač", 0)]

    func listWorkspaces() async throws -> [Workspace] {
        [SnapshotData.workspace, Workspace(id: String(repeating: "cd", count: 32), name: "Side project", applicationId: "app")]
    }

    func listChannelGroups(namespaceId: String) async throws -> [ChannelGroupListing] {
        Self.channels.map { ChannelGroupListing(groupId: "g-\($0.0)", name: $0.0, contextIds: ["ctx-\($0.0)"], isPrivate: $0.1) }
            + Self.dms.map { ChannelGroupListing(groupId: "g-dm-\($0.0)", name: "DM_CONTEXT_\($0.0)", contextIds: ["dm-\($0.0)"]) }
    }

    func isMember(contextId: String) async throws -> Bool { true }
    func joinChannel(contextId: String) async throws {}
    func foundWorkspace(name: String) async throws -> FoundedWorkspace {
        FoundedWorkspace(namespaceId: "", haEnabled: true, haError: nil)
    }
    func createChannelGroup(namespaceId: String, name: String, isPublic: Bool) async throws -> String { "" }
    func createContext(groupId: String, applicationId: String, name: String, initArgs: JSONValue) async throws -> String { "" }
    func createInvitation(namespaceId: String) async throws -> SignedGroupOpenInvitation {
        throw ChatError.noRelay
    }
    func joinWorkspace(namespaceId: String, invitation: SignedGroupOpenInvitation) async throws -> JoinedWorkspace {
        JoinedWorkspace(published: true, relayURL: "")
    }
    func events(contextId: String) -> AsyncThrowingStream<ChatLiveEvent, Error> { AsyncThrowingStream { $0.finish() } }

    fileprivate static func unread(_ contextId: String) -> (Int, Int) {
        if let c = channels.first(where: { "ctx-\($0.0)" == contextId }) { return (c.2, c.3) }
        if let d = dms.first(where: { "dm-\($0.0)" == contextId }) { return (d.1, 0) }
        return (0, 0)
    }

    fileprivate static func info(_ contextId: String) -> String {
        if contextId.hasPrefix("dm-") {
            let name = String(contextId.dropFirst(3))
            let description = #"{\"c\":\"\#(name)\",\"o\":\"Fran\"}"#
            return #"{"name":"DM","context_type":"Dm","description":"\#(description)","created_at":1760000000,"creator":"x"}"#
        }
        let name = String(contextId.dropFirst(4))
        return #"{"name":"\#(name)","context_type":"Channel","description":"","created_at":1760000000,"creator":"x"}"#
    }
}

final class SnapshotContract: ChatContract, @unchecked Sendable {
    func query(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? {
        switch method {
        case "get_messages": return try parse(SnapshotData.pageJSON())
        case "get_profiles": return try parse(SnapshotData.profilesJSON())
        case "get_info": return try parse(SnapshotBackend.info(contextId))
        case "get_unread_count": return .number(Double(SnapshotBackend.unread(contextId).0))
        case "get_unread_mentions": return .number(Double(SnapshotBackend.unread(contextId).1))
        case "get_member_role": return .string("Admin")
        case "get_draft": return .string("")
        default: return .null
        }
    }

    func execute(contextId: String, method: String, args: JSONValue) async throws -> JSONValue? { .null }

    private func parse(_ json: String) throws -> JSONValue {
        try MeroJSON.decode(JSONValue.self, from: Data(json.utf8))
    }
}
