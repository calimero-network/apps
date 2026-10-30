import Foundation
import MeroKit

/// A workspace invitation: Calimero 1.0's org invite token in the SDK's link
/// shape (`MeroKitUI.InvitationLinkPayload`), plus the workspace's name:
///
/// - payload: `{"invitation": {"orgId": "<org>", "token": "inv_…"}, "namespaceId": "<org>", "groupAlias": "<workspace>"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-crm/join?invitation=<token>`
///
/// The invite token is a bearer secret the org's node minted; redeeming it
/// (`POST /invites/{token}/redeem`) joins the org it belongs to. Decoding also
/// takes an optional `data` envelope and `groupName`. Another app's link is
/// refused, and so is a pre-1.0 signed invitation (a 1.0 cluster cannot redeem it).
public struct CrmInvitation: Sendable {
    /// The registry package, which is also the links' slug (`APP_SLUG`).
    public static let packageName = "com.calimero.mero-crm"

    public let invitation: OrgInvitation
    public let workspaceName: String?

    /// The org (workspace) it admits to.
    public var namespaceId: String { invitation.orgId }

    public init(invitation: OrgInvitation, workspaceName: String?) {
        self.invitation = invitation
        self.workspaceName = workspaceName
    }

    /// The shareable token.
    public func token() throws -> String {
        var payload: [String: JSONValue] = [
            "invitation": .object(["orgId": .string(invitation.orgId), "token": .string(invitation.token)]),
            "namespaceId": .string(invitation.orgId),
        ]
        if let name = workspaceName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            payload["groupAlias"] = .string(name)
        }
        return try InviteCodec.encode(JSONValue.object(payload))
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
        guard let token = inner["invitation"]?["token"]?.stringValue, !token.isEmpty else { return nil }
        let org = inner["invitation"]?["orgId"]?.stringValue ?? inner["namespaceId"]?.stringValue ?? ""
        guard !org.isEmpty else { return nil }
        let name = [inner["groupAlias"]?.stringValue, inner["groupName"]?.stringValue]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }
        return CrmInvitation(invitation: OrgInvitation(orgId: org, token: token), workspaceName: name)
    }
}
