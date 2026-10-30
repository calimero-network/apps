import Combine
import Foundation
import MeroKit

/// Creating a channel the way the web app does (`utils/createChannel.ts`): one
/// team per channel in the org (`join: everyone`, or `invite` for a private
/// channel), the channel's single app instance inside it, then the
/// creator's `set_profile`.
struct ChannelCreator: Sendable {
    let backend: any ChatBackend

    /// Returns the new context id.
    func create(
        in workspace: Workspace, name: String, isPublic: Bool, username: String, now: Date = Date()
    ) async throws -> String {
        let groupId = try await backend.createChannelGroup(namespaceId: workspace.id, name: name, isPublic: isPublic)
        let contextId = try await backend.createContext(
            groupId: groupId, applicationId: workspace.applicationId, name: name,
            initArgs: ChatAPI.channelInitArgs(name: name, createdAt: chatTimestamp(now)))
        if !username.isEmpty {
            // Best effort, as on the web: the channel exists either way.
            try? await ChatAPI(contract: backend.contract).setProfile(contextId, username: username)
        }
        return contextId
    }
}

/// One workspace's channels and DMs.
///
/// Every channel is a team in the org holding one app instance; a DM is
/// the same with a `DM_CONTEXT_` name and `context_type: "Dm"`. A channel the
/// account is not a member of yet (an open channel someone else made) is
/// listed with a Join action: its contract calls only work after joining.
@MainActor
final class ChannelsModel: ObservableObject {
    @Published private(set) var channels: [ChannelEntry] = []
    @Published private(set) var directMessages: [ChannelEntry] = []
    @Published private(set) var isLoading = false
    @Published private(set) var isWorking = false
    @Published var errorText: String?

    let workspace: Workspace
    private let backend: any ChatBackend
    private let api: ChatAPI
    private let displayName: @MainActor () -> String
    private let me: String

    init(workspace: Workspace, backend: any ChatBackend, displayName: @escaping @MainActor () -> String) {
        self.workspace = workspace
        self.backend = backend
        self.api = ChatAPI(contract: backend.contract)
        self.displayName = displayName
        self.me = ChatIdentity.userId(accountHex: backend.account) ?? ""
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let groups = try await backend.listChannelGroups(namespaceId: workspace.id)
            var entries: [ChannelEntry] = []
            for group in groups {
                guard let contextId = group.contextIds.first else { continue }
                entries.append(await entry(contextId: contextId, group: group))
            }
            channels = entries.filter { $0.kind == .channel }.sorted(by: Self.order)
            directMessages = entries.filter { $0.kind == .dm }.sorted(by: Self.order)
            errorText = nil
        } catch {
            errorText = ChatErrorText.describe(error)
        }
    }

    private func entry(contextId: String, group: ChannelGroupListing) async -> ChannelEntry {
        let groupName = group.name ?? ""
        let looksLikeDm = groupName.hasPrefix(ChatConstants.dmAliasPrefix)
        let fallbackKind: ChannelKind = looksLikeDm ? .dm : .channel
        let fallbackName = looksLikeDm || groupName.isEmpty ? ChatIdentity.short(contextId) : groupName
        let joined = (try? await backend.isMember(contextId: contextId)) ?? false
        guard joined else {
            return ChannelEntry(
                id: contextId, groupId: group.groupId, name: fallbackName, kind: fallbackKind, isJoined: false,
                unread: 0, isPrivate: group.isPrivate)
        }
        let info = try? await api.getInfo(contextId)
        let unread = (try? await api.getUnreadCount(contextId)) ?? 0
        let mentions = unread > 0 ? ((try? await api.getUnreadMentions(contextId)) ?? 0) : 0
        let kind = info?.kind ?? fallbackKind
        var name = fallbackName
        if let info {
            name = info.dmTitle(viewer: me) ?? (info.name.isEmpty ? fallbackName : info.name)
        }
        return ChannelEntry(
            id: contextId, groupId: group.groupId, name: name, kind: kind, isJoined: true, unread: unread,
            mentions: mentions, isPrivate: group.isPrivate)
    }

    nonisolated static func order(_ lhs: ChannelEntry, _ rhs: ChannelEntry) -> Bool {
        lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
    }

    /// Join an open channel, then claim this account's name in it.
    func join(_ entry: ChannelEntry) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await backend.joinChannel(contextId: entry.id)
            let username = displayName()
            if !username.isEmpty { try? await api.setProfile(entry.id, username: username) }
            await load()
        } catch {
            errorText = ChatErrorText.describe(error)
        }
    }

    @discardableResult
    func create(name rawName: String, isPublic: Bool) async -> Bool {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "#", with: "")
        if let problem = ChatFormat.channelNameProblem(name, existing: channels.map(\.name)) {
            errorText = problem
            return false
        }
        isWorking = true
        defer { isWorking = false }
        do {
            _ = try await ChannelCreator(backend: backend).create(
                in: workspace, name: name, isPublic: isPublic, username: displayName())
            await load()
            return true
        } catch {
            errorText = ChatErrorText.describe(error)
            return false
        }
    }

    /// Clear a channel's badge once it has been opened.
    func markOpened(_ contextId: String) {
        if let i = channels.firstIndex(where: { $0.id == contextId }) {
            channels[i].unread = 0
            channels[i].mentions = 0
        }
        if let i = directMessages.firstIndex(where: { $0.id == contextId }) {
            directMessages[i].unread = 0
            directMessages[i].mentions = 0
        }
    }
}
