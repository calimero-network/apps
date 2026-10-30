import Foundation
import MeroKit

/// A workspace invitation on Calimero 1.0: an org invite token, in the
/// swift-sdk's link payload (`MeroKitUI.InvitationLinkPayload`) plus the
/// workspace's name:
///
/// - payload: JSON `{"invitation": {"orgId": "…", "token": "inv_…"}, "namespaceId": "<org>", "groupAlias": "<name>"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.chat/join?invitation=<token>`
///
/// The invite token is a bearer secret the org's node minted
/// (`POST /orgs/{org}/invites`); joining redeems it (`POST /invites/{token}/redeem`).
/// Decoding takes the payload under an optional `data` envelope, the name under
/// `groupName` (preferred) or `groupAlias`, and a link, a `calimero://` link or
/// a bare token. A link naming another app is refused, since redeeming it
/// would join that app's org; a pre-1.0 signed group invitation is refused,
/// since a 1.0 cluster can't redeem it.
struct ChatInvitation: Sendable {
    let invitation: OrgInvitation
    let workspaceName: String?

    /// The org the invitation admits to.
    var namespaceId: String { invitation.orgId }

    // MARK: Encoding

    private struct Payload: Encodable {
        let invitation: OrgInvitation
        let namespaceId: String
        let groupAlias: String?
    }

    /// The shareable token.
    func token() throws -> String {
        try InviteCodec.encode(Payload(invitation: invitation, namespaceId: invitation.orgId, groupAlias: workspaceName))
    }

    /// The shareable link.
    func link() throws -> String {
        InviteLink.invitation(token: try token(), slug: ChatConstants.packageName)
    }

    // MARK: Decoding

    /// Parse a pasted link, a deep link or a bare token. `nil` when nothing in
    /// it is a chat invitation.
    static func parse(_ input: String) -> ChatInvitation? {
        guard let token = InviteLink.token(fromPasted: input, expectedSlug: ChatConstants.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// Parse the decoded payload JSON.
    static func parse(json: String) -> ChatInvitation? {
        guard let parsed = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return nil }
        let inner = parsed["data"] ?? parsed
        let wrapped: JSONValue = inner["invitation"] ?? inner
        guard let token = wrapped["token"]?.stringValue, !token.isEmpty,
            let org = wrapped["orgId"]?.stringValue ?? inner["namespaceId"]?.stringValue, !org.isEmpty
        else { return nil }
        let name = [inner["groupName"]?.stringValue, inner["groupAlias"]?.stringValue]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty }
        return ChatInvitation(invitation: OrgInvitation(orgId: org, token: token), workspaceName: name)
    }
}
