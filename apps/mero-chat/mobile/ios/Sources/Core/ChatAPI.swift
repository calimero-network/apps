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
    static func sendMessageArgs(text: String, timestamp: UInt64, parentMessage: String? = nil) -> JSONValue {
        var args: [String: JSONValue] = [
            "message": .string(text),
            "mentions": .array([]),
            "mentions_usernames": .array([]),
            "timestamp": .number(Double(timestamp)),
        ]
        if let parentMessage { args["parent_message"] = .string(parentMessage) }
        return .object(args)
    }

    /// `edit_message(message_id, new_message, timestamp, parent_id?)`.
    static func editMessageArgs(messageId: String, text: String, timestamp: UInt64) -> JSONValue {
        ["message_id": .string(messageId), "new_message": .string(text), "timestamp": .number(Double(timestamp))]
    }

    /// `delete_message(message_id, parent_id?)`.
    static func deleteMessageArgs(messageId: String) -> JSONValue {
        ["message_id": .string(messageId)]
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

    func getMessages(_ contextId: String, limit: Int, offset: Int) async throws -> MessagePage {
        let value = try await contract.query(
            contextId: contextId, method: Method.getMessages, args: Self.getMessagesArgs(limit: limit, offset: offset))
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

    // MARK: Writes

    @discardableResult
    func sendMessage(_ contextId: String, text: String) async throws -> SentMessage {
        let args = Self.sendMessageArgs(text: text, timestamp: chatTimestamp(now()))
        let value = try await contract.execute(contextId: contextId, method: Method.sendMessage, args: args)
        return try ChatJSON.decode(SentMessage.self, value, method: Method.sendMessage)
    }

    func editMessage(_ contextId: String, messageId: String, text: String) async throws {
        let args = Self.editMessageArgs(messageId: messageId, text: text, timestamp: chatTimestamp(now()))
        _ = try await contract.execute(contextId: contextId, method: Method.editMessage, args: args)
    }

    func deleteMessage(_ contextId: String, messageId: String) async throws {
        _ = try await contract.execute(
            contextId: contextId, method: Method.deleteMessage, args: Self.deleteMessageArgs(messageId: messageId))
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
