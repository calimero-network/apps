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
/// The web app (#730) shares its own link instead, `https://<its origin>/?invite=inv_…`:
/// the token alone. Those (and a bare `inv_…` token) parse too, with no org:
/// the node names it when the token is redeemed.
///
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
        if let token = InviteLink.token(fromPasted: input, expectedSlug: ChatConstants.packageName),
            let json = InviteCodec.decode(token: token), let parsed = parse(json: json)
        {
            return parsed
        }
        return webToken(input).map {
            ChatInvitation(invitation: OrgInvitation(namespaceId: "", token: $0), workspaceName: nil)
        }
    }

    /// The token of the web app's link (`?invite=inv_…`), or a bare `inv_…` token.
    static func webToken(_ input: String) -> String? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if let components = URLComponents(string: trimmed), components.scheme != nil {
            let token = components.queryItems?.first(where: { $0.name == "invite" })?.value?
                .trimmingCharacters(in: .whitespaces)
            return token?.hasPrefix("inv_") == true ? token : nil
        }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-."))
        guard trimmed.hasPrefix("inv_"), trimmed.unicodeScalars.allSatisfy(allowed.contains) else { return nil }
        return trimmed
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
