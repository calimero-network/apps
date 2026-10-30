import Foundation
import MeroKit

/// A workspace invitation on Calimero 1.0: an org invite token in the
/// swift-sdk's link payload (`OrgInvitation`, shared with kotlin-sdk):
///
/// - payload: JSON `{"invitation": "inv_…", "namespaceId": "<org>", "contextId"?: "…", "name"?: "<workspace>"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.chat/join?invitation=<token>`
///
/// The invite token is a bearer secret the org's node minted
/// (`POST /orgs/{org}/invites`); joining redeems it (`POST /invites/{token}/redeem`).
/// Decoding takes the payload under an optional `data` envelope, the name
/// under `name` (or the web app's `groupName` / `groupAlias`), and a link, a
/// `calimero://` link or a bare token. A link naming another app is refused,
/// since redeeming it would join that app's org; a pre-1.0 signed group
/// invitation is refused, since a 1.0 cluster can't redeem it.
struct ChatInvitation: Sendable {
    let invitation: OrgInvitation

    init(invitation: OrgInvitation, workspaceName: String?) {
        self.invitation = OrgInvitation(
            namespaceId: invitation.namespaceId, token: invitation.token, contextId: invitation.contextId,
            name: workspaceName ?? invitation.name)
    }

    /// The org the invitation admits to.
    var namespaceId: String { invitation.namespaceId }
    /// The workspace's name, for the "Join …?" prompt (unsigned: a hint only).
    var workspaceName: String? { invitation.name }

    // MARK: Encoding

    /// The shareable token.
    func token() throws -> String { try invitation.encoded() }

    /// The shareable link.
    func link() throws -> String { try invitation.link(slug: ChatConstants.packageName) }

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
        guard let token = inner["invitation"]?.stringValue, !token.isEmpty,
            let org = inner["namespaceId"]?.stringValue, !org.isEmpty
        else { return nil }
        let name = [inner["name"]?.stringValue, inner["groupName"]?.stringValue, inner["groupAlias"]?.stringValue]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty }
        return ChatInvitation(
            invitation: OrgInvitation(namespaceId: org, token: token, contextId: inner["contextId"]?.stringValue),
            workspaceName: name)
    }
}
