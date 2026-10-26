import Foundation
import MeroKit

/// The chat contract's methods the app uses, with the web app's argument names
/// and shapes (`app/src/api/dataSource/clientApiDataSource.ts`).
///
/// Reads go through ``ChatContract/query(contextId:method:args:)`` and writes
/// through ``ChatContract/execute(contextId:method:args:)``. An optional
/// argument the web app leaves `undefined` is left out here too, rather than
/// sent as `null`: `JSON.stringify` drops it, and the contract reads a missing
/// `Option` as `None`.
struct ChatAPI: Sendable {
    let contract: any ChatContract
    /// The clock timestamps are taken from (seconds). Injectable for tests.
    var now: @Sendable () -> Date = { Date() }

    init(contract: any ChatContract, now: @escaping @Sendable () -> Date = { Date() }) {
        self.contract = contract
        self.now = now
    }

    // MARK: Method names

    enum Method {
        static let getInfo = "get_info"
        static let getMessages = "get_messages"
        static let getMessagesFrom = "get_messages_from"
        static let getProfiles = "get_profiles"
        static let getUnreadCount = "get_unread_count"
        static let sendMessage = "send_message"
        static let editMessage = "edit_message"
        static let deleteMessage = "delete_message"
        static let updateReaction = "update_reaction"
        static let setProfile = "set_profile"
        static let markAsRead = "mark_as_read"
        static let getUnreadMentions = "get_unread_mentions"
        static let searchMessages = "search_messages"
        static let saveDraft = "save_draft"
        static let getDraft = "get_draft"
        static let deleteDraft = "delete_draft"
        static let updateInfo = "update_info"
        static let getMemberRole = "get_member_role"
        static let listRoles = "list_roles"
        static let setMemberRole = "set_member_role"
    }

    // MARK: Argument encoding (pure, so tests pin it)

    /// `get_messages(parent_message?, limit?, offset?, search_term?)`. Offset 0
    /// is the newest page; the window is counted back from the end.
    static func getMessagesArgs(limit: Int, offset: Int, parentMessage: String? = nil) -> JSONValue {
        var args: [String: JSONValue] = ["limit": .number(Double(limit)), "offset": .number(Double(offset))]
        if let parentMessage { args["parent_message"] = .string(parentMessage) }
        return .object(args)
    }

    /// `get_messages_from(start, limit?)`: by absolute index, ascending.
    static func getMessagesFromArgs(start: UInt64, limit: Int) -> JSONValue {
        ["start": .number(Double(start)), "limit": .number(Double(limit))]
    }

    /// `send_message(message, mentions, mentions_usernames, parent_message?, timestamp, files?, images?)`.
    /// `mentions` are `UserId`s, `mentionsUsernames` the names as typed
    /// (`everyone` / `here` for a broadcast), as `MessageInput.tsx` sends them.
    static func sendMessageArgs(
        text: String, timestamp: UInt64, parentMessage: String? = nil, mentions: [String] = [],
        mentionsUsernames: [String] = []
    ) -> JSONValue {
        var args: [String: JSONValue] = [
            "message": .string(text),
            "mentions": .array(mentions.map { .string($0) }),
            "mentions_usernames": .array(mentionsUsernames.map { .string($0) }),
            "timestamp": .number(Double(timestamp)),
        ]
        if let parentMessage { args["parent_message"] = .string(parentMessage) }
        return .object(args)
    }

    /// `edit_message(message_id, new_message, timestamp, parent_id?)`.
    /// `parent_id` names the thread a reply is in.
    static func editMessageArgs(messageId: String, text: String, timestamp: UInt64, parentId: String? = nil) -> JSONValue {
        var args: [String: JSONValue] = [
            "message_id": .string(messageId), "new_message": .string(text), "timestamp": .number(Double(timestamp)),
        ]
        if let parentId { args["parent_id"] = .string(parentId) }
        return .object(args)
    }

    /// `delete_message(message_id, parent_id?)`.
    static func deleteMessageArgs(messageId: String, parentId: String? = nil) -> JSONValue {
        var args: [String: JSONValue] = ["message_id": .string(messageId)]
        if let parentId { args["parent_id"] = .string(parentId) }
        return .object(args)
    }

    /// `search_messages(query, cursor?, limit?)`: the web app sends `cursor: null` for the first page.
    static func searchArgs(query: String, cursor: String?, limit: Int) -> JSONValue {
        ["query": .string(query), "cursor": cursor.map { .string($0) } ?? .null, "limit": .number(Double(limit))]
    }

    /// `update_info(name?, description?)`: a field left out is kept.
    static func updateInfoArgs(name: String?, description: String?) -> JSONValue {
        var args: [String: JSONValue] = [:]
        if let name { args["name"] = .string(name) }
        if let description { args["description"] = .string(description) }
        return .object(args)
    }

    /// `update_reaction(message_id, emoji, add)`.
    static func updateReactionArgs(messageId: String, emoji: String, add: Bool) -> JSONValue {
        ["message_id": .string(messageId), "emoji": .string(emoji), "add": .bool(add)]
    }

    /// `set_profile(username, avatar)`: the web app sends `avatar: null` explicitly.
    static func setProfileArgs(username: String) -> JSONValue {
        ["username": .string(username), "avatar": .null]
    }

    /// `mark_as_read(timestamp)`.
    static func markAsReadArgs(timestamp: UInt64) -> JSONValue {
        ["timestamp": .number(Double(timestamp))]
    }

    /// `init(name, context_type, description, created_at, creator_username)`
    /// for a new channel, as `utils/createChannel.ts` founds one.
    static func channelInitArgs(name: String, createdAt: UInt64) -> JSONValue {
        [
            "name": .string(name),
            "context_type": .string(ChannelKind.channel.rawValue),
            "description": "",
            "created_at": .number(Double(createdAt)),
            "creator_username": "",
        ]
    }

    // MARK: Reads

    func getInfo(_ contextId: String) async throws -> ChannelInfo {
        let value = try await contract.query(contextId: contextId, method: Method.getInfo, args: [:])
        return try ChatJSON.decode(ChannelInfo.self, value, method: Method.getInfo)
    }

    /// A page of the channel, or of one thread when `parentMessage` names its root.
    func getMessages(_ contextId: String, limit: Int, offset: Int, parentMessage: String? = nil) async throws
        -> MessagePage
    {
        let value = try await contract.query(
            contextId: contextId, method: Method.getMessages,
            args: Self.getMessagesArgs(limit: limit, offset: offset, parentMessage: parentMessage))
        return try ChatJSON.decode(MessagePage.self, value, method: Method.getMessages)
    }

    func getMessagesFrom(_ contextId: String, start: UInt64, limit: Int) async throws -> MessagePage {
        let value = try await contract.query(
            contextId: contextId, method: Method.getMessagesFrom,
            args: Self.getMessagesFromArgs(start: start, limit: limit))
        return try ChatJSON.decode(MessagePage.self, value, method: Method.getMessagesFrom)
    }

    func getProfiles(_ contextId: String) async throws -> [UserProfile] {
        let value = try await contract.query(contextId: contextId, method: Method.getProfiles, args: [:])
        return try ChatJSON.decode([UserProfile].self, value, method: Method.getProfiles)
    }

    func getUnreadCount(_ contextId: String) async throws -> Int {
        let value = try await contract.query(contextId: contextId, method: Method.getUnreadCount, args: [:])
        guard let count = value?.doubleValue, count >= 0 else {
            throw ChatError.badResponse(method: Method.getUnreadCount, detail: "\(value ?? .null) is not a count")
        }
        return Int(count)
    }

    func getUnreadMentions(_ contextId: String) async throws -> Int {
        let value = try await contract.query(contextId: contextId, method: Method.getUnreadMentions, args: [:])
        guard let count = value?.doubleValue, count >= 0 else {
            throw ChatError.badResponse(method: Method.getUnreadMentions, detail: "\(value ?? .null) is not a count")
        }
        return Int(count)
    }

    func searchMessages(_ contextId: String, query: String, cursor: String? = nil, limit: Int = 20) async throws
        -> SearchPage
    {
        let value = try await contract.query(
            contextId: contextId, method: Method.searchMessages,
            args: Self.searchArgs(query: query, cursor: cursor, limit: limit))
        return try ChatJSON.decode(SearchPage.self, value, method: Method.searchMessages)
    }

    /// The draft saved for `channel` (the channel's name, as `useDraft.ts` keys it).
    func getDraft(_ contextId: String, channel: String) async throws -> String {
        let value = try await contract.query(
            contextId: contextId, method: Method.getDraft, args: ["channel": .string(channel)])
        return value?.stringValue ?? ""
    }

    func getMemberRole(_ contextId: String, identity: String) async throws -> ChatRole {
        let value = try await contract.query(
            contextId: contextId, method: Method.getMemberRole, args: ["identity": .string(identity)])
        return ChatRole(rawValue: value?.stringValue ?? "") ?? .user
    }

    /// Members with a role other than `User`. The contract returns `[[UserId, Role]]`.
    func listRoles(_ contextId: String) async throws -> [String: ChatRole] {
        let value = try await contract.query(contextId: contextId, method: Method.listRoles, args: [:])
        let pairs = try ChatJSON.decode([[String]].self, value, method: Method.listRoles)
        var roles: [String: ChatRole] = [:]
        for pair in pairs where pair.count == 2 {
            roles[pair[0]] = ChatRole(rawValue: pair[1]) ?? .user
        }
        return roles
    }

    // MARK: Writes

    @discardableResult
    func sendMessage(
        _ contextId: String, text: String, parentMessage: String? = nil, mentions: [String] = [],
        mentionsUsernames: [String] = []
    ) async throws -> SentMessage {
        let args = Self.sendMessageArgs(
            text: text, timestamp: chatTimestamp(now()), parentMessage: parentMessage, mentions: mentions,
            mentionsUsernames: mentionsUsernames)
        let value = try await contract.execute(contextId: contextId, method: Method.sendMessage, args: args)
        return try ChatJSON.decode(SentMessage.self, value, method: Method.sendMessage)
    }

    func editMessage(_ contextId: String, messageId: String, text: String, parentId: String? = nil) async throws {
        let args = Self.editMessageArgs(
            messageId: messageId, text: text, timestamp: chatTimestamp(now()), parentId: parentId)
        _ = try await contract.execute(contextId: contextId, method: Method.editMessage, args: args)
    }

    func deleteMessage(_ contextId: String, messageId: String, parentId: String? = nil) async throws {
        _ = try await contract.execute(
            contextId: contextId, method: Method.deleteMessage,
            args: Self.deleteMessageArgs(messageId: messageId, parentId: parentId))
    }

    func saveDraft(_ contextId: String, channel: String, text: String) async throws {
        _ = try await contract.execute(
            contextId: contextId, method: Method.saveDraft, args: ["channel": .string(channel), "text": .string(text)])
    }

    func deleteDraft(_ contextId: String, channel: String) async throws {
        _ = try await contract.execute(
            contextId: contextId, method: Method.deleteDraft, args: ["channel": .string(channel)])
    }

    /// Rename the channel or change its description (admins only; the contract refuses others).
    func updateInfo(_ contextId: String, name: String? = nil, description: String? = nil) async throws {
        _ = try await contract.execute(
            contextId: contextId, method: Method.updateInfo,
            args: Self.updateInfoArgs(name: name, description: description))
    }

    func setMemberRole(_ contextId: String, target: String, role: ChatRole) async throws {
        _ = try await contract.execute(
            contextId: contextId, method: Method.setMemberRole,
            args: ["target": .string(target), "role": .string(role.rawValue)])
    }

    func updateReaction(_ contextId: String, messageId: String, emoji: String, add: Bool) async throws {
        _ = try await contract.execute(
            contextId: contextId, method: Method.updateReaction,
            args: Self.updateReactionArgs(messageId: messageId, emoji: emoji, add: add))
    }

    func setProfile(_ contextId: String, username: String) async throws {
        _ = try await contract.execute(
            contextId: contextId, method: Method.setProfile, args: Self.setProfileArgs(username: username))
    }

    func markAsRead(_ contextId: String) async throws {
        _ = try await contract.execute(
            contextId: contextId, method: Method.markAsRead,
            args: Self.markAsReadArgs(timestamp: chatTimestamp(now())))
    }
}
