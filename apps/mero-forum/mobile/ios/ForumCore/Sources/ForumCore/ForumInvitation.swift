import Foundation
import MeroKit

/// An invitation in the web app's format (`app/src/lib/inviteCodec.ts`), so a
/// link minted on either side opens on the other:
///
/// - payload: `{"invitation": <SignedGroupOpenInvitation>, "kind": "namespace" | "forum",
///   "groupId": "<namespace>", "groupAlias": "<space name>", "forumId", "forumName", "contextId"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-forum/join?invitation=<token>`
///
/// The signed invitation always grants the NAMESPACE (forum access is inherited
/// from it); `forumId` / `contextId` only say where to land afterwards.
public struct ForumInvitation: Sendable {
    public enum Kind: String, Sendable { case space = "namespace", forum }

    public let invitation: SignedGroupOpenInvitation
    public let kind: Kind
    public let spaceName: String?
    public let forumId: String?
    public let forumName: String?
    public let contextId: String?

    public init(
        invitation: SignedGroupOpenInvitation, kind: Kind = .space, spaceName: String? = nil,
        forumId: String? = nil, forumName: String? = nil, contextId: String? = nil
    ) {
        self.invitation = invitation
        self.kind = kind
        self.spaceName = spaceName
        self.forumId = forumId
        self.forumName = forumName
        self.contextId = contextId
    }

    /// The namespace it admits to: the hex of its SIGNED `group_id`, never a
    /// field beside it, so a tampered wrapper cannot redirect a join.
    public var namespaceId: String {
        Hex.encode(invitation.invitation.groupId.map { UInt8(truncatingIfNeeded: $0) })
    }

    /// What to call it in a prompt: the forum for a forum invite, else the space.
    public var title: String {
        if kind == .forum, let forumName, !forumName.isEmpty { return forumName }
        if let spaceName, !spaceName.isEmpty { return spaceName }
        return "a space"
    }

    // MARK: Encoding

    private struct Payload: Encodable {
        let invitation: SignedGroupOpenInvitation
        let kind: String
        let groupId: String
        let groupAlias: String?
        let forumId: String?
        let forumName: String?
        let contextId: String?
    }

    /// The shareable token.
    public func token() throws -> String {
        try InviteCodec.encode(
            Payload(
                invitation: invitation, kind: kind.rawValue, groupId: namespaceId,
                groupAlias: spaceName?.nilIfEmpty, forumId: forumId, forumName: forumName?.nilIfEmpty,
                contextId: contextId))
    }

    /// The shareable link.
    public func link() throws -> String {
        InviteLink.invitation(token: try token(), slug: ForumConstants.packageName)
    }

    // MARK: Decoding

    /// Parse a link (https or `calimero://`), the web app's old `?invite=` link,
    /// a bare token or raw JSON. `nil` when it holds no forum invitation, and
    /// for another app's link.
    public static func parse(_ input: String) -> ForumInvitation? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix("{") { return parse(json: trimmed) }
        let token: String?
        if let legacy = legacyToken(trimmed) {
            token = legacy
        } else {
            token = InviteLink.token(fromPasted: trimmed, expectedSlug: ForumConstants.packageName)
        }
        guard let token, let json = InviteCodec.decode(token: token) else { return nil }
        return parse(json: json)
    }

    /// `…?invite=<code>`: what this app's web build shared before platform links.
    private static func legacyToken(_ raw: String) -> String? {
        guard raw.contains("?"), !raw.contains("invitation="),
            let query = raw.split(separator: "?", maxSplits: 1).last
        else { return nil }
        for pair in query.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1)
            if parts.count == 2, parts[0] == "invite" {
                return String(parts[1]).removingPercentEncoding ?? String(parts[1])
            }
        }
        return nil
    }

    /// Parse the decoded payload JSON (the web's `parsePayload`).
    public static func parse(json: String) -> ForumInvitation? {
        guard let parsed = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return nil }
        let inner = parsed["data"] ?? parsed
        if let wrapped = inner["invitation"], isSignedInvitation(wrapped), let signed = decodeSigned(wrapped) {
            let kind: Kind = inner["kind"]?.stringValue == "forum" ? .forum : .space
            return ForumInvitation(
                invitation: signed, kind: kind,
                spaceName: (inner["groupName"]?.stringValue ?? inner["groupAlias"]?.stringValue)?.nilIfEmpty,
                forumId: inner["forumId"]?.stringValue?.nilIfEmpty,
                forumName: inner["forumName"]?.stringValue?.nilIfEmpty,
                contextId: inner["contextId"]?.stringValue?.nilIfEmpty)
        }
        if isSignedInvitation(inner), let signed = decodeSigned(inner) {
            return ForumInvitation(invitation: signed)
        }
        return nil
    }

    private static func isSignedInvitation(_ value: JSONValue) -> Bool {
        guard case .object(let fields) = value, case .object? = fields["invitation"] else { return false }
        return fields["inviter_signature"]?.stringValue != nil || fields["inviterSignature"]?.stringValue != nil
    }

    private static func decodeSigned(_ value: JSONValue) -> SignedGroupOpenInvitation? {
        guard case .object(var fields) = value else { return nil }
        if fields["inviter_signature"] == nil, let camel = fields["inviterSignature"] {
            fields["inviter_signature"] = camel
            fields.removeValue(forKey: "inviterSignature")
        }
        guard let data = try? JSONEncoder().encode(JSONValue.object(fields)) else { return nil }
        return try? JSONDecoder().decode(SignedGroupOpenInvitation.self, from: data)
    }
}

extension String {
    var nilIfEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
