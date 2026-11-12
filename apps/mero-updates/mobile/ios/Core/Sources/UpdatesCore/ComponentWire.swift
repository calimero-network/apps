import Foundation

/// The contract's component ABI (`logic/res/abi.json`) against the v1 types the
/// app keeps (`Records.swift`), as the web app's `app/src/lib/updatesClient.ts`
/// does it. The generated `UpdatesClient` speaks the ABI itself (camelCase
/// methods and arguments, `null` for an unset `option`, the `u64` `since` as a
/// decimal string); this is the one place its JSON meets the v1 types:
///
/// - Out (a record argument, `JSONValue.wire(_:)`): every key becomes camelCase.
/// - In (`JSONValue.decoded(as:)`): every key becomes snake_case again, and the
///   `u64` fields the contract sends as decimal strings (``u64Fields``) become
///   numbers.
///
/// A refusal stays MeroKit's `AppError` (`422 APP_ERROR {code, fields}`).
/// (== Kotlin `ComponentWire`.)
public enum ComponentWire {
    /// Every contract method (minus `init`): whether it is a view, and its parameters in order.
    public static let methods: [String: (view: Bool, params: [String])] = [
        "addComment": (false, ["postId", "parentId", "body"]),
        "addTeammate": (false, ["account"]),
        "archiveCategory": (false, ["categoryId"]),
        "askQuestion": (false, ["title", "body", "categoryId"]),
        "createCategory": (false, ["name", "emoji", "color"]),
        "deleteComment": (false, ["commentId"]),
        "deleteDraft": (false, ["draftId"]),
        "deletePost": (false, ["postId"]),
        "editCategory": (false, ["categoryId", "name", "emoji", "color"]),
        "editComment": (false, ["commentId", "body"]),
        "editUpdate": (false, ["postId", "input"]),
        "getEngagement": (true, []),
        "getMe": (true, []),
        "getOverview": (true, []),
        "getPost": (true, ["postId"]),
        "getSettings": (true, []),
        "listAsks": (true, ["status"]),
        "listCategories": (true, []),
        "listComments": (true, ["postId"]),
        "listContributions": (true, ["since"]),
        "listDrafts": (true, []),
        "listMetrics": (true, []),
        "listPeople": (true, []),
        "listPosts": (true, ["kind", "categoryId", "cursor", "limit"]),
        "markRead": (false, ["postId"]),
        "offerHelp": (false, ["askId", "note"]),
        "publishUpdate": (false, ["input"]),
        "react": (false, ["postId", "emoji", "on"]),
        "removeTeammate": (false, ["account"]),
        "saveDraft": (false, ["draftId", "title", "payload"]),
        "setAskStatus": (false, ["askId", "status"]),
        "setMutedCategories": (false, ["categoryIds"]),
        "setOfferStatus": (false, ["askId", "account", "status"]),
        "setProfile": (false, ["name", "firm"]),
        "setQuestionStatus": (false, ["postId", "status"]),
        "setSettings": (false, ["companyName", "cadenceDays"]),
        "withdrawOffer": (false, ["askId"]),
    ]

    /// The `u64` fields (by their snake_case name) the contract sends as
    /// decimal strings (== `U64_FIELDS` in `updatesClient.ts`). Only these
    /// become numbers: a metric's `value` or an all-digit id stays a string.
    public static let u64Fields: Set<String> = [
        "accepted_at", "accepted_offers", "ask_count", "at", "comment_count", "comments", "count", "created_at",
        "edited_at", "first_at", "joined_at", "last_read_at", "last_update_at", "metric_count", "next_due_at",
        "offer_count", "offers", "open_ask_count", "open_asks", "open_questions", "people", "published_at",
        "reactions", "read_count", "unread_count", "unread_updates", "update_count", "updated_at", "updates_read",
        "updates_total",
    ]

    // MARK: Conversion

    /// The contract's answer as the generated client reads it.
    static func incoming(_ data: Data) throws -> Data {
        guard let value = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else {
            return data
        }
        return try JSONSerialization.data(withJSONObject: fromWire(value), options: [.fragmentsAllowed])
    }

    static func toWire(_ value: Any) -> Any {
        if let list = value as? [Any] { return list.map(toWire) }
        guard let object = value as? [String: Any] else { return value }
        var out: [String: Any] = [:]
        for (key, v) in object { out[camel(key)] = toWire(v) }
        return out
    }

    static func fromWire(_ value: Any) -> Any {
        if let list = value as? [Any] { return list.map(fromWire) }
        guard let object = value as? [String: Any] else { return value }
        var out: [String: Any] = [:]
        for (key, v) in object {
            let name = snake(key)
            if u64Fields.contains(name), let text = v as? String, let n = UInt64(text) {
                out[name] = NSNumber(value: n)
            } else {
                out[name] = fromWire(v)
            }
        }
        return out
    }

    /// `post_id` → `postId`.
    static func camel(_ key: String) -> String {
        var out = ""
        var upper = false
        for c in key {
            if c == "_" {
                upper = true
            } else {
                out += upper ? c.uppercased() : String(c)
                upper = false
            }
        }
        return out
    }

    /// `postId` → `post_id`.
    static func snake(_ key: String) -> String {
        var out = ""
        for c in key {
            out += c.isUppercase ? "_" + c.lowercased() : String(c)
        }
        return out
    }
}
