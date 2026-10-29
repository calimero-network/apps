import Foundation

// Comments. The contract keeps flat, per-document comments (`add_comment`,
// `list_comments`): a body, an author and a time, with no block and no parent.
// The web app has no comments UI yet, so this app sets the convention: a
// comment on a block starts its body with `[[block:<id>]]`, a reply with
// `[[reply:<comment id>]]`, then a space and the text. A body without either
// is a comment on the whole document. Anything reading the raw body still sees
// the words. (== Kotlin `Comments.kt`.)

/// One comment, its body's prefix read.
public struct DocComment: Identifiable, Equatable, Sendable {
    public let id: String
    /// The author's account, 64 hex.
    public let author: String
    /// Nanoseconds since the Unix epoch.
    public let createdAt: UInt64
    /// The words, prefix removed.
    public let text: String
    /// The block the comment is on; nil for the whole document or a reply.
    public let blockId: String?
    /// The comment this answers.
    public let replyTo: String?

    public init(id: String, author: String, createdAt: UInt64, text: String, blockId: String? = nil, replyTo: String? = nil) {
        self.id = id
        self.author = author
        self.createdAt = createdAt
        self.text = text
        self.blockId = blockId
        self.replyTo = replyTo
    }

    public init(_ dto: CommentDto) {
        let parsed = CommentBody.parse(dto.body)
        self.init(
            id: dto.id, author: dto.author, createdAt: dto.createdAt, text: parsed.text, blockId: parsed.blockId,
            replyTo: parsed.replyTo)
    }
}

/// A comment and its replies, oldest first.
public struct CommentThread: Identifiable, Equatable, Sendable {
    public var id: String { root.id }
    public let root: DocComment
    public let replies: [DocComment]

    public init(root: DocComment, replies: [DocComment]) {
        self.root = root
        self.replies = replies
    }

    /// When anything was last said in it.
    public var lastActivity: UInt64 { replies.last?.createdAt ?? root.createdAt }
}

public enum CommentBody {
    /// The body to send.
    public static func encode(_ text: String, blockId: String? = nil, replyTo: String? = nil) -> String {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let replyTo { return "[[reply:\(replyTo)]] \(words)" }
        if let blockId { return "[[block:\(blockId)]] \(words)" }
        return words
    }

    /// A body's text and what its prefix names.
    public static func parse(_ body: String) -> (text: String, blockId: String?, replyTo: String?) {
        guard body.hasPrefix("[["), let close = body.range(of: "]]") else { return (body, nil, nil) }
        let tag = body[body.index(body.startIndex, offsetBy: 2)..<close.lowerBound]
        let rest = body[close.upperBound...]
        let text = String(rest.hasPrefix(" ") ? rest.dropFirst() : rest)
        guard let colon = tag.firstIndex(of: ":") else { return (body, nil, nil) }
        let key = tag[..<colon]
        let value = String(tag[tag.index(after: colon)...])
        guard !value.isEmpty, !value.contains(where: { $0.isWhitespace }) else { return (body, nil, nil) }
        switch key {
        case "block": return (text, value, nil)
        case "reply": return (text, nil, value)
        default: return (body, nil, nil)
        }
    }

    /// Comments as threads: each reply under the thread its parent is in
    /// (a reply to a reply joins the same thread), threads newest activity
    /// last, like a conversation. A reply whose parent is gone stands alone.
    public static func threads(_ comments: [DocComment]) -> [CommentThread] {
        let sorted = comments.sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
        let byId = Dictionary(sorted.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        func rootId(_ c: DocComment) -> String {
            var current = c
            var seen: Set<String> = [c.id]
            while let parent = current.replyTo, let next = byId[parent], seen.insert(next.id).inserted {
                current = next
            }
            return current.id
        }
        var roots: [DocComment] = []
        var replies: [String: [DocComment]] = [:]
        for c in sorted {
            let root = rootId(c)
            if root == c.id { roots.append(c) } else { replies[root, default: []].append(c) }
        }
        return roots.map { CommentThread(root: $0, replies: replies[$0.id] ?? []) }
    }

    /// How many comments are on each block, counting replies in its threads.
    public static func countsByBlock(_ threads: [CommentThread]) -> [String: Int] {
        var out: [String: Int] = [:]
        for t in threads {
            guard let block = t.root.blockId else { continue }
            out[block, default: 0] += 1 + t.replies.count
        }
        return out
    }
}
