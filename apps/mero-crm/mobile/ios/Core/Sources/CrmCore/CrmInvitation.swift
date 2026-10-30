import Foundation
import MeroKit

/// A workspace invitation: Calimero 1.0's org invite token in the SDK's link
/// shape (``OrgInvitation``), the workspace's name as its `name`:
///
/// - payload: `{"invitation": "inv_…", "namespaceId": "<org>", "name": "<workspace>"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-crm/join?invitation=<token>`
///
/// The invite token is a bearer secret the org's node minted; redeeming it
/// (`POST /invites/{token}/redeem`) joins the org it belongs to. Decoding also
/// takes an optional `data` envelope and `groupAlias` / `groupName`. Another app's
/// link is refused, and so is a pre-1.0 signed invitation (a 1.0 cluster cannot redeem it).
public struct CrmInvitation: Sendable {
    /// The registry package, which is also the links' slug (`APP_SLUG`).
    public static let packageName = "com.calimero.mero-crm"

    public let invitation: OrgInvitation
    public let workspaceName: String?

    /// The org (workspace) it admits to.
    public var namespaceId: String { invitation.namespaceId }

    public init(invitation: OrgInvitation, workspaceName: String?) {
        self.invitation = invitation
        self.workspaceName = workspaceName
    }

    /// The shareable token.
    public func token() throws -> String {
        let name = workspaceName?.trimmingCharacters(in: .whitespacesAndNewlines)
        return try OrgInvitation(
            namespaceId: invitation.namespaceId, token: invitation.token, contextId: invitation.contextId,
            name: name?.isEmpty == false ? name : nil
        ).encoded()
    }

    /// The shareable link.
    public func link() throws -> String {
        InviteLink.invitation(token: try token(), slug: Self.packageName)
    }

    /// Read a pasted link (https or `calimero://`) or a bare token. Nil when it
    /// is not a Mero CRM invitation, including another app's link.
    public static func parse(_ input: String) -> CrmInvitation? {
        guard let token = InviteLink.token(fromPasted: input, expectedSlug: packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// Read the decoded payload JSON.
    public static func parse(json: String) -> CrmInvitation? {
        guard let parsed = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return nil }
        let inner = parsed["data"] ?? parsed
        guard let data = try? JSONEncoder().encode(inner),
            let base = try? JSONDecoder().decode(OrgInvitation.self, from: data)
        else { return nil }
        let name = [base.name, inner["groupAlias"]?.stringValue, inner["groupName"]?.stringValue]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }
        return CrmInvitation(invitation: base, workspaceName: name)
    }
}
