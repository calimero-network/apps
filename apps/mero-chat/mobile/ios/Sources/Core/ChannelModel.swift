import Combine
import Foundation
import MeroKit

/// One open channel: paged history, sending, editing, deleting, reactions,
/// the profile name, and live updates.
///
/// **Paging.** History is read with `get_messages(limit, offset)` exactly as
/// the web app reads it: offset 0 is the newest page, counted back from the
/// end. Every message also carries its stable `index`, so the model keeps the
/// messages keyed by id and ordered by index, and asks for the page that ends
/// where the oldest loaded message begins (`offset = total - lowestIndex`). A
/// stale total can only make that page overlap what is loaded (deduplicated),
/// never skip messages. When a refresh finds a gap after the newest loaded
/// message, `get_messages_from(start)` (the contract's resumable read) fills it.
///
/// **Threads.** The same model opens one thread when it is given the
/// thread's root: every read is `get_messages(parent_message:)` and every
/// write names the parent, as `useThreadMessages.ts` does. A thread is read
/// whole from its newest page back; `get_messages_from` (top level only) is
/// not used there.
///
/// **Live updates.** The relay's SSE stream for the context, through the
/// account's Bearer session; any non-presence event triggers a refresh of the
/// newest page. With no session (or once the stream ends) the model polls.
@MainActor
final class ChannelModel: ObservableObject {
    enum LiveStatus: Equatable {
        case off
        case streaming
        case polling
    }

    /// Ascending by index.
    @Published private(set) var messages: [ChatMessage] = []
    /// `UserId` -> username, from `get_profiles`.
    @Published private(set) var names: [String: String] = [:]
    @Published private(set) var isLoading = false
    @Published private(set) var isLoadingOlder = false
    @Published private(set) var hasOlder = false
    @Published private(set) var isSending = false
    @Published private(set) var liveStatus: LiveStatus = .off
    @Published var errorText: String?
    /// This account's role in the channel (`get_member_role`).
    @Published private(set) var myRole: ChatRole = .user
    /// The draft saved in the contract when the channel opened (`get_draft`).
    @Published private(set) var savedDraft = ""

    let channel: ChannelEntry
    /// The root of the open thread, or `nil` for the channel itself.
    let thread: ChatMessage?
    /// This account's `UserId` in the contract (base58).
    let me: String
    let pageSize: Int
    /// Seconds between refreshes when there is no live stream.
    var pollInterval: TimeInterval

    private let api: ChatAPI
    private let backend: any ChatBackend
    private var totalCount = 0
    private var liveTask: Task<Void, Never>?
    private var refreshing = false
    private var refreshPending = false
    private var draftTask: Task<Void, Never>?
    /// How long typing pauses before the draft is saved (`useDraft.ts`: 4 s).
    var draftDelay: TimeInterval = 4

    init(
        channel: ChannelEntry, backend: any ChatBackend, thread: ChatMessage? = nil,
        pageSize: Int = ChatConstants.messagePageSize, pollInterval: TimeInterval = 5,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.channel = channel
        self.thread = thread
        self.backend = backend
        self.api = ChatAPI(contract: backend.contract, now: now)
        self.me = ChatIdentity.userId(accountHex: backend.account) ?? ""
        self.pageSize = pageSize
        self.pollInterval = pollInterval
    }

    deinit {
        liveTask?.cancel()
        draftTask?.cancel()
    }

    private var parentId: String? { thread?.id }

    // MARK: Display helpers

    func isMine(_ message: ChatMessage) -> Bool {
        !me.isEmpty && message.sender == me
    }

    func displayName(of userId: String) -> String {
        if userId == me, let mine = names[me] { return mine }
        return names[userId] ?? ChatIdentity.short(userId)
    }

    var myProfileName: String? { names[me] }

    /// Your own messages, and anyone's for an admin or mod (the contract's rule).
    func canDelete(_ message: ChatMessage) -> Bool {
        !message.deleted && (isMine(message) || myRole.canModerate)
    }

    func canEdit(_ message: ChatMessage) -> Bool {
        !message.deleted && isMine(message)
    }

    /// The members a mention can name, by display name.
    var mentionCandidates: [(userId: String, name: String)] {
        names.filter { $0.key != me }.map { (userId: $0.key, name: $0.value) }.sorted { $0.name < $1.name }
    }

    /// The `UserId`s and names a message mentions, as `MessageInput.tsx`
    /// collects them: `@name` for a member whose display name it is, and
    /// `@everyone` / `@here` as broadcast names with no id.
    nonisolated static func mentions(in text: String, names: [String: String]) -> (ids: [String], usernames: [String]) {
        var ids: [String] = []
        var usernames: [String] = []
        let byName = Dictionary(names.map { ($0.value.lowercased(), $0.key) }, uniquingKeysWith: { first, _ in first })
        for token in text.split(whereSeparator: { $0.isWhitespace }) where token.hasPrefix("@") {
            let name = token.dropFirst().trimmingCharacters(in: .punctuationCharacters).lowercased()
            guard !name.isEmpty else { continue }
            if name == "everyone" || name == "here" {
                if !usernames.contains(name) { usernames.append(name) }
            } else if let id = byName[name] {
                if !ids.contains(id) { ids.append(id) }
                if !usernames.contains(names[id] ?? name) { usernames.append(names[id] ?? name) }
            }
        }
        return (ids, usernames)
    }

    // MARK: History

    func loadInitial() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let page = try await api.getMessages(channel.id, limit: pageSize, offset: 0, parentMessage: parentId)
            messages = Self.merge([], page.messages)
            totalCount = page.totalCount
            hasOlder = (messages.first?.index ?? 0) > 0
            errorText = nil
            await loadProfiles()
            if thread == nil {
                try? await api.markAsRead(channel.id)
                myRole = (try? await api.getMemberRole(channel.id, identity: me)) ?? .user
                savedDraft = (try? await api.getDraft(channel.id, channel: channel.name)) ?? ""
            }
        } catch {
            errorText = ChatErrorText.describe(error)
        }
    }

    func loadOlder() async {
        guard hasOlder, !isLoadingOlder, let lowest = messages.first?.index else { return }
        isLoadingOlder = true
        defer { isLoadingOlder = false }
        do {
            let offset = Self.olderOffset(totalCount: totalCount, lowestIndex: lowest)
            let page = try await api.getMessages(
                channel.id, limit: pageSize, offset: offset, parentMessage: parentId)
            totalCount = max(totalCount, page.totalCount)
            messages = Self.merge(messages, page.messages)
            let newLowest = messages.first?.index ?? 0
            // No progress means the window had nothing older to give.
            hasOlder = newLowest > 0 && newLowest < lowest
        } catch {
            errorText = ChatErrorText.describe(error)
        }
    }

    /// The `get_messages` offset whose page ends just before `lowestIndex`.
    nonisolated static func olderOffset(totalCount: Int, lowestIndex: UInt64) -> Int {
        max(0, totalCount - Int(clamping: lowestIndex))
    }

    /// Union by id (the incoming copy wins: it is the newer read), ordered by index.
    nonisolated static func merge(_ existing: [ChatMessage], _ incoming: [ChatMessage]) -> [ChatMessage] {
        var byId: [String: ChatMessage] = [:]
        for message in existing { byId[message.id] = message }
        for message in incoming { byId[message.id] = message }
        return byId.values.sorted { lhs, rhs in
            lhs.index == rhs.index ? lhs.timestamp < rhs.timestamp : lhs.index < rhs.index
        }
    }

    /// Re-read the newest page (and fill any gap behind it). Concurrent
    /// requests coalesce into one more pass.
    func refreshNewest() async {
        if refreshing {
            refreshPending = true
            return
        }
        refreshing = true
        defer { refreshing = false }
        repeat {
            refreshPending = false
            await refreshOnce()
        } while refreshPending
    }

    private func refreshOnce() async {
        do {
            let page = try await api.getMessages(channel.id, limit: pageSize, offset: 0, parentMessage: parentId)
            let highest = messages.last?.index
            var merged = Self.merge(messages, page.messages)
            if thread == nil, let highest, let freshLowest = page.messages.map(\.index).min(), freshLowest > highest + 1 {
                let gap = Int(clamping: freshLowest - highest - 1)
                let fill = try await api.getMessagesFrom(channel.id, start: highest + 1, limit: min(gap, 200))
                merged = Self.merge(merged, fill.messages)
            }
            let arrived = merged.count > messages.count
            totalCount = max(totalCount, page.totalCount)
            messages = merged
            if !hasOlder, (messages.first?.index ?? 0) > 0 { hasOlder = true }
            if arrived, thread == nil { try? await api.markAsRead(channel.id) }
        } catch {
            errorText = ChatErrorText.describe(error)
        }
    }

    /// Re-read one message by its index (after an edit, a delete or a
    /// reaction on a message that may be older than the newest page).
    private func refreshMessage(at index: UInt64) async {
        guard thread == nil else { return await refreshNewest() }
        if let page = try? await api.getMessagesFrom(channel.id, start: index, limit: 1) {
            messages = Self.merge(messages, page.messages)
        }
    }

    func loadProfiles() async {
        guard let profiles = try? await api.getProfiles(channel.id) else { return }
        var map: [String: String] = [:]
        for profile in profiles where !profile.username.isEmpty { map[profile.identity] = profile.username }
        names = map
    }

    // MARK: Writes

    @discardableResult
    func send(_ rawText: String) async -> Bool {
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return false }
        isSending = true
        defer { isSending = false }
        do {
            let mentioned = Self.mentions(in: text, names: names)
            try await api.sendMessage(
                channel.id, text: text, parentMessage: parentId, mentions: mentioned.ids,
                mentionsUsernames: mentioned.usernames)
            errorText = nil
            if thread == nil { clearDraft() }
            await refreshNewest()
            return true
        } catch {
            errorText = ChatErrorText.describe(error)
            return false
        }
    }

    func edit(_ message: ChatMessage, to rawText: String) async {
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isMine(message), !text.isEmpty, text != message.text else { return }
        do {
            try await api.editMessage(channel.id, messageId: message.id, text: text, parentId: parentId)
            await refreshMessage(at: message.index)
        } catch {
            errorText = ChatErrorText.describe(error)
        }
    }

    func delete(_ message: ChatMessage) async {
        guard canDelete(message) else { return }
        do {
            try await api.deleteMessage(channel.id, messageId: message.id, parentId: parentId)
            await refreshMessage(at: message.index)
        } catch {
            errorText = ChatErrorText.describe(error)
        }
    }

    func toggleReaction(_ emoji: String, on message: ChatMessage) async {
        guard !message.deleted else { return }
        let add = !message.hasReaction(emoji, by: me)
        do {
            try await api.updateReaction(channel.id, messageId: message.id, emoji: emoji, add: add)
            await refreshMessage(at: message.index)
        } catch {
            errorText = ChatErrorText.describe(error)
        }
    }

    /// Set this account's name in the channel. The contract keeps the first
    /// name an account registers in a context (only the avatar changes after).
    @discardableResult
    func setProfileName(_ rawName: String) async -> Bool {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            errorText = "Enter a name."
            return false
        }
        guard name.count <= 50 else {
            errorText = "Names can be at most 50 characters."
            return false
        }
        do {
            try await api.setProfile(channel.id, username: name)
            await loadProfiles()
            return true
        } catch {
            errorText = ChatErrorText.describe(error)
            return false
        }
    }

    /// Register `rawName` here unless this account already has a name in the
    /// channel. Namespace members inherit open channels, so they can read and
    /// write one without ever joining it explicitly, and then nothing else
    /// names them (the web app's auto-join sweep covers the same gap). Silent
    /// and best-effort: the channel works either way. Returns whether a name
    /// was registered.
    @discardableResult
    func ensureProfile(_ rawName: String) async -> Bool {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 50, !me.isEmpty, names[me] == nil else { return false }
        do {
            try await api.setProfile(channel.id, username: name)
        } catch {
            return false
        }
        await loadProfiles()
        return names[me] != nil
    }

    // MARK: Drafts

    /// The composer changed: save it once typing pauses, or drop the saved
    /// draft when it is emptied (`useDraft.ts`).
    func draftChanged(_ text: String) {
        guard thread == nil else { return }
        draftTask?.cancel()
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let delay = UInt64(max(0, draftDelay) * 1_000_000_000)
        let contextId = channel.id
        let name = channel.name
        let api = api
        draftTask = Task {
            try? await Task.sleep(nanoseconds: delay)
            guard !Task.isCancelled else { return }
            if trimmed.isEmpty {
                try? await api.deleteDraft(contextId, channel: name)
            } else {
                try? await api.saveDraft(contextId, channel: name, text: text)
            }
        }
    }

    private func clearDraft() {
        draftTask?.cancel()
        savedDraft = ""
        let api = api
        let contextId = channel.id
        let name = channel.name
        draftTask = Task { try? await api.deleteDraft(contextId, channel: name) }
    }

    // MARK: Live updates

    func startLive() {
        guard liveTask == nil else { return }
        if backend.canSubscribe {
            liveStatus = .streaming
            let stream = backend.events(contextId: channel.id)
            let contextId = channel.id
            liveTask = Task { [weak self] in
                do {
                    for try await event in stream {
                        guard let self else { return }
                        if ChannelModel.shouldRefresh(on: event, contextId: contextId) {
                            await self.refreshNewest()
                        }
                    }
                } catch {
                    // The stream gave up; fall back to polling below.
                }
                guard !Task.isCancelled else { return }
                await self?.pollLoop()
            }
        } else {
            liveTask = Task { [weak self] in await self?.pollLoop() }
        }
    }

    func stopLive() {
        liveTask?.cancel()
        liveTask = nil
        liveStatus = .off
    }

    nonisolated static func shouldRefresh(on event: ChatLiveEvent, contextId: String) -> Bool {
        event.kind != "Ephemeral" && (event.contextId.isEmpty || event.contextId == contextId)
    }

    private func pollLoop() async {
        liveStatus = .polling
        while !Task.isCancelled {
            let nanos = UInt64(max(0.01, pollInterval) * 1_000_000_000)
            try? await Task.sleep(nanoseconds: nanos)
            if Task.isCancelled { break }
            await refreshNewest()
        }
    }
}
