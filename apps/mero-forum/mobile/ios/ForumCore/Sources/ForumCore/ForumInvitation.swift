import Foundation
import MeroKit

/// An invitation on Calimero 1.0: an org invite token in the SDK's link
/// payload (`MeroKitUI.InvitationLinkPayload`), plus where to land:
///
/// - payload: `{"invitation": {"orgId": "…", "token": "inv_…"}, "namespaceId": "<org>",
///   "kind": "namespace" | "forum", "groupAlias": "<space name>", "forumId", "forumName", "contextId"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-forum/join?invitation=<token>`
///
/// The invite token always admits to the ORG (the space; forum access is
/// inherited from it, as open teams are); `forumId` / `contextId` only say
/// where to land afterwards. It is a bearer secret the org's node minted
/// (`POST /orgs/{org}/invites`); joining redeems it (`POST /invites/{token}/redeem`).
/// A pre-1.0 signed group invitation is refused: a 1.0 cluster can't redeem it.
public struct ForumInvitation: Sendable {
    public enum Kind: String, Sendable { case space = "namespace", forum }

    public let invitation: OrgInvitation
    public let kind: Kind
    public let spaceName: String?
    public let forumId: String?
    public let forumName: String?
    public let contextId: String?

    public init(
        invitation: OrgInvitation, kind: Kind = .space, spaceName: String? = nil,
        forumId: String? = nil, forumName: String? = nil, contextId: String? = nil
    ) {
        self.invitation = invitation
        self.kind = kind
        self.spaceName = spaceName
        self.forumId = forumId
        self.forumName = forumName
        self.contextId = contextId
    }

    /// The org (space) it admits to: the invitation's own `orgId`, never a
    /// field beside it.
    public var namespaceId: String { invitation.orgId }

    /// What to call it in a prompt: the forum for a forum invite, else the space.
    public var title: String {
        if kind == .forum, let forumName, !forumName.isEmpty { return forumName }
        if let spaceName, !spaceName.isEmpty { return spaceName }
        return "a space"
    }

    // MARK: Encoding

    private struct Payload: Encodable {
        let invitation: OrgInvitation
        let namespaceId: String
        let kind: String
        let groupAlias: String?
        let forumId: String?
        let forumName: String?
        let contextId: String?
    }

    /// The shareable token.
    public func token() throws -> String {
        try InviteCodec.encode(
            Payload(
                invitation: invitation, namespaceId: namespaceId, kind: kind.rawValue,
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

    /// Parse the decoded payload JSON.
    public static func parse(json: String) -> ForumInvitation? {
        guard let parsed = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return nil }
        let inner = parsed["data"] ?? parsed
        let wrapped: JSONValue = inner["invitation"] ?? inner
        guard let token = wrapped["token"]?.stringValue, !token.isEmpty,
            let org = (wrapped["orgId"]?.stringValue ?? inner["namespaceId"]?.stringValue)?.nilIfEmpty
        else { return nil }
        let kind: Kind = inner["kind"]?.stringValue == "forum" ? .forum : .space
        return ForumInvitation(
            invitation: OrgInvitation(orgId: org, token: token), kind: kind,
            spaceName: (inner["groupName"]?.stringValue ?? inner["groupAlias"]?.stringValue
                ?? inner["spaceName"]?.stringValue)?.nilIfEmpty,
            forumId: inner["forumId"]?.stringValue?.nilIfEmpty,
            forumName: inner["forumName"]?.stringValue?.nilIfEmpty,
            contextId: inner["contextId"]?.stringValue?.nilIfEmpty)
    }
}

extension String {
    var nilIfEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
