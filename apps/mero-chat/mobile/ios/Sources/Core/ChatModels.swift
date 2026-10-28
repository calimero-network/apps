import Foundation
import MeroKit

// MARK: - Contract wire types (com.calimero.chat, logic/src/lib.rs)
//
// Every type here mirrors a serde shape the contract returns. Field names are
// the contract's snake_case. Numbers are decoded leniently (an integer or an
// integral double) because a relay hands results back as generic JSON.

/// One attachment on a message (`AttachmentPublic`).
struct ChatAttachment: Decodable, Equatable, Sendable {
    let name: String
    let mimeType: String
    let size: UInt64
    let blobId: String

    private enum CodingKeys: String, CodingKey {
        case name, size
        case mimeType = "mime_type"
        case blobId = "blob_id"
    }

    init(name: String, mimeType: String, size: UInt64, blobId: String) {
        self.name = name
        self.mimeType = mimeType
        self.size = size
        self.blobId = blobId
    }

    var isImage: Bool { mimeType.hasPrefix("image/") }

    /// `AttachmentInput`, as `send_message` takes it (`blob_id_str`, as `ChatContainer.tsx` sends it).
    var input: JSONValue {
        [
            "name": .string(name), "mime_type": .string(mimeType), "size": .number(Double(size)),
            "blob_id_str": .string(blobId),
        ]
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        mimeType = try c.decodeIfPresent(String.self, forKey: .mimeType) ?? ""
        size = try c.lenientUInt64(.size) ?? 0
        blobId = try c.decodeIfPresent(String.self, forKey: .blobId) ?? ""
    }
}

/// `MessageWithReactions`: one message of a `get_messages` / `get_messages_from` page.
struct ChatMessage: Decodable, Equatable, Identifiable, Sendable {
    /// Stable position in the channel (appends never renumber, deletes keep their slot).
    let index: UInt64
    /// Seconds since the epoch, as the sender stamped it.
    let timestamp: UInt64
    /// The sender's `UserId`: base58 of their account bytes.
    let sender: String
    let id: String
    let text: String
    let mentions: [String]
    let mentionsUsernames: [String]
    let files: [ChatAttachment]
    let images: [ChatAttachment]
    let editedOn: UInt64?
    /// emoji -> the `UserId`s that reacted with it.
    let reactions: [String: [String]]
    let deleted: Bool
    let threadCount: UInt32
    /// When the newest reply landed (seconds), `0` with no replies.
    let threadLastTimestamp: UInt64
    let parentMessageId: String?

    private enum CodingKeys: String, CodingKey {
        case index, timestamp, sender, id, text, mentions, files, images, reactions, deleted
        case mentionsUsernames = "mentions_usernames"
        case editedOn = "edited_on"
        case threadCount = "thread_count"
        case threadLastTimestamp = "thread_last_timestamp"
        case parentMessageId = "parent_message_id"
    }

    init(
        index: UInt64, timestamp: UInt64, sender: String, id: String, text: String, editedOn: UInt64? = nil,
        reactions: [String: [String]] = [:], deleted: Bool = false
    ) {
        self.index = index
        self.timestamp = timestamp
        self.sender = sender
        self.id = id
        self.text = text
        self.mentions = []
        self.mentionsUsernames = []
        self.files = []
        self.images = []
        self.editedOn = editedOn
        self.reactions = reactions
        self.deleted = deleted
        self.threadCount = 0
        self.threadLastTimestamp = 0
        self.parentMessageId = nil
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        index = try c.lenientUInt64(.index) ?? 0
        timestamp = try c.lenientUInt64(.timestamp) ?? 0
        sender = try c.decodeIfPresent(String.self, forKey: .sender) ?? ""
        id = try c.decode(String.self, forKey: .id)
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        mentions = try c.decodeIfPresent([String].self, forKey: .mentions) ?? []
        mentionsUsernames = try c.decodeIfPresent([String].self, forKey: .mentionsUsernames) ?? []
        files = try c.decodeIfPresent([ChatAttachment].self, forKey: .files) ?? []
        images = try c.decodeIfPresent([ChatAttachment].self, forKey: .images) ?? []
        editedOn = try c.lenientUInt64(.editedOn)
        reactions = try c.decodeIfPresent([String: [String]].self, forKey: .reactions) ?? [:]
        deleted = try c.decodeIfPresent(Bool.self, forKey: .deleted) ?? false
        threadCount = UInt32(clamping: try c.lenientUInt64(.threadCount) ?? 0)
        threadLastTimestamp = try c.lenientUInt64(.threadLastTimestamp) ?? 0
        parentMessageId = try c.decodeIfPresent(String.self, forKey: .parentMessageId)
    }

    /// Whether `userId` reacted with `emoji`.
    func hasReaction(_ emoji: String, by userId: String) -> Bool {
        reactions[emoji]?.contains(userId) ?? false
    }
}

/// `FullMessageResponse`.
struct MessagePage: Decodable, Equatable, Sendable {
    /// The channel's (or the filter's) total: how many messages exist, not how many came back.
    let totalCount: Int
    let messages: [ChatMessage]
    let startPosition: Int

    private enum CodingKeys: String, CodingKey {
        case messages
        case totalCount = "total_count"
        case startPosition = "start_position"
    }

    init(totalCount: Int, messages: [ChatMessage], startPosition: Int) {
        self.totalCount = totalCount
        self.messages = messages
        self.startPosition = startPosition
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        totalCount = Int(clamping: try c.lenientUInt64(.totalCount) ?? 0)
        messages = try c.decodeIfPresent([ChatMessage].self, forKey: .messages) ?? []
        startPosition = Int(clamping: try c.lenientUInt64(.startPosition) ?? 0)
    }
}

/// What `send_message` / `edit_message` return (the contract's `Message`):
/// only what the app reads back.
struct SentMessage: Decodable, Equatable, Sendable {
    let id: String
    let text: String
    let timestamp: UInt64

    private enum CodingKeys: String, CodingKey { case id, text, timestamp }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        timestamp = try c.lenientUInt64(.timestamp) ?? 0
    }
}

/// `ContextType`: fixed when the context is created.
enum ChannelKind: String, Sendable, Hashable {
    case channel = "Channel"
    case dm = "Dm"
}

/// `ContextInfo` (`get_info`).
struct ChannelInfo: Decodable, Equatable, Sendable {
    let name: String
    let kind: ChannelKind
    let description: String
    let createdAt: UInt64
    /// The creator's `UserId` (base58).
    let creator: String

    private enum CodingKeys: String, CodingKey {
        case name, description, creator
        case kind = "context_type"
        case createdAt = "created_at"
    }

    init(name: String, kind: ChannelKind, description: String = "", createdAt: UInt64 = 0, creator: String = "") {
        self.name = name
        self.kind = kind
        self.description = description
        self.createdAt = createdAt
        self.creator = creator
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        let raw = try c.decodeIfPresent(String.self, forKey: .kind) ?? ChannelKind.channel.rawValue
        kind = raw.lowercased() == "dm" ? .dm : .channel
        description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
        createdAt = try c.lenientUInt64(.createdAt) ?? 0
        creator = try c.decodeIfPresent(String.self, forKey: .creator) ?? ""
    }

    /// What to call a DM from `me`'s side. The web app writes both names into
    /// the description as `{"c": creatorName, "o": otherName}`; the side that
    /// is not the creator shows the creator's name.
    func dmTitle(viewer me: String) -> String? {
        guard kind == .dm, let data = description.data(using: .utf8),
            let names = try? JSONDecoder().decode([String: String].self, from: data)
        else { return nil }
        let pick = creator == me ? names["o"] : names["c"]
        guard let pick, !pick.isEmpty else { return nil }
        return pick
    }
}

/// `UserProfile` (`get_profiles`).
struct UserProfile: Decodable, Equatable, Sendable {
    /// The member's `UserId` (base58).
    let identity: String
    let username: String
    let avatar: String?

    init(identity: String, username: String, avatar: String? = nil) {
        self.identity = identity
        self.username = username
        self.avatar = avatar
    }
}

/// `Role`: a member's standing in a channel. `User` is everyone not listed.
enum ChatRole: String, Sendable, Hashable, CaseIterable {
    case user = "User"
    case mod = "Mod"
    case admin = "Admin"
    case banned = "Banned"

    /// May change the channel's info and other members' roles.
    var isAdmin: Bool { self == .admin }
    /// May delete other members' messages.
    var canModerate: Bool { self == .admin || self == .mod }
}

/// `SearchHit` (`search_messages`).
struct SearchHit: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    /// Set for a thread reply: the top-level message it replies to.
    let parentMessageId: String?
    let timestamp: UInt64
    let sender: String
    /// Plain text around the first match.
    let snippet: String
    /// The match inside `snippet`, in UTF-16 code units.
    let matchStart: Int
    let matchEnd: Int

    private enum CodingKeys: String, CodingKey {
        case id, timestamp, sender, snippet
        case parentMessageId = "parent_message_id"
        case matchStart = "match_start"
        case matchEnd = "match_end"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        parentMessageId = try c.decodeIfPresent(String.self, forKey: .parentMessageId)
        timestamp = try c.lenientUInt64(.timestamp) ?? 0
        sender = try c.decodeIfPresent(String.self, forKey: .sender) ?? ""
        snippet = try c.decodeIfPresent(String.self, forKey: .snippet) ?? ""
        matchStart = Int(try c.lenientUInt64(.matchStart) ?? 0)
        matchEnd = Int(try c.lenientUInt64(.matchEnd) ?? 0)
    }

    /// `snippet` split around the match, safe for any offsets the relay sends.
    var highlighted: (before: String, match: String, after: String) {
        let units = Array(snippet.utf16)
        let start = min(max(0, matchStart), units.count)
        let end = min(max(start, matchEnd), units.count)
        func text(_ range: Range<Int>) -> String { String(decoding: units[range], as: UTF16.self) }
        return (text(0..<start), text(start..<end), text(end..<units.count))
    }
}

/// `SearchPage` (`search_messages`).
struct SearchPage: Decodable, Equatable, Sendable {
    let hits: [SearchHit]
    /// Pass back for the next page; `nil` once the oldest message was read.
    let nextCursor: String?

    private enum CodingKeys: String, CodingKey {
        case hits
        case nextCursor = "next_cursor"
    }
}

// MARK: - App models

/// A workspace: a namespace this account is a member of.
struct Workspace: Identifiable, Hashable, Sendable {
    /// The namespace id, 64 hex.
    let id: String
    let name: String
    /// The application the namespace runs (what a new channel is created with).
    let applicationId: String
}

/// One channel-group a namespace holds: a subgroup with (normally) one context.
struct ChannelGroupListing: Equatable, Sendable {
    let groupId: String
    let name: String?
    let contextIds: [String]
    /// A restricted subgroup: only members it adds see it (the lock icon).
    var isPrivate = false
}

/// A channel or DM as the lists show it.
struct ChannelEntry: Identifiable, Hashable, Sendable {
    /// The context id.
    let id: String
    let groupId: String
    let name: String
    let kind: ChannelKind
    /// Whether this account is a member of the channel's group (its contract calls work).
    let isJoined: Bool
    var unread: Int
    /// Unread messages that mention this account (`get_unread_mentions`).
    var mentions = 0
    var isPrivate = false
}

/// The outcome of founding a workspace.
struct FoundedWorkspace: Equatable, Sendable {
    let namespaceId: String
    /// Whether the cloud agreed to host the namespace (invitations need it).
    let haEnabled: Bool
    let haError: String?
}

/// The outcome of redeeming an invitation.
struct JoinedWorkspace: Equatable, Sendable {
    /// NOT "joined": membership lands once peers apply the op.
    let published: Bool
    /// The relay that admitted the account.
    let relayURL: String
}

/// A live event for a context, as far as the app cares.
struct ChatLiveEvent: Equatable, Sendable {
    let contextId: String
    let kind: String
}

// MARK: - Lenient numbers

extension KeyedDecodingContainer {
    /// An unsigned integer that may arrive as an integer or as an integral double.
    func lenientUInt64(_ key: Key) throws -> UInt64? {
        guard contains(key), try !decodeNil(forKey: key) else { return nil }
        if let value = try? decode(UInt64.self, forKey: key) { return value }
        let double = try decode(Double.self, forKey: key)
        guard double >= 0, double.rounded() == double, double < 1.8e19 else {
            throw DecodingError.dataCorruptedError(
                forKey: key, in: self, debugDescription: "\(double) is not an unsigned integer")
        }
        return UInt64(double)
    }
}

// MARK: - Attachments

/// A file or image picked in the composer, not uploaded yet.
struct PendingAttachment: Equatable, Sendable, Identifiable {
    let id = UUID()
    let name: String
    let mimeType: String
    let data: Data

    var isImage: Bool { mimeType.hasPrefix("image/") }

    static func == (lhs: PendingAttachment, rhs: PendingAttachment) -> Bool { lhs.id == rhs.id }
}

/// Blob bytes already fetched or uploaded this session, by blob id. A blob id
/// is a content hash, so an entry never goes stale.
final class BlobCache: @unchecked Sendable {
    static let shared = BlobCache()

    private let cache = NSCache<NSString, NSData>()

    init(limitBytes: Int = 64 * 1024 * 1024) {
        cache.totalCostLimit = limitBytes
    }

    func data(for blobId: String) -> Data? {
        cache.object(forKey: blobId as NSString) as Data?
    }

    func store(_ data: Data, for blobId: String) {
        cache.setObject(data as NSData, forKey: blobId as NSString, cost: data.count)
    }
}
