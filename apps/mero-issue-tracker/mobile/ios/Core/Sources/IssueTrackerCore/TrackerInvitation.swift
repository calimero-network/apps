import Foundation
import MeroKit

/// A workspace invitation on Calimero 1.0: the SDK's ``OrgInvitation`` link
/// payload, with the web app's extra fields beside it.
///
/// - payload: `{"invitation": "inv_…", "namespaceId": "<org>", "name": "<workspace>", "groupAlias": "<workspace>", "kind": "namespace"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-issue-tracker/join?invitation=<token>`
///
/// The invite token is a bearer secret the org's node minted
/// (`POST /orgs/{org}/invites`); joining redeems it (`POST /invites/{token}/redeem`).
/// Reading takes an optional `data` envelope; the name comes from `name`,
/// then the legacy `groupName` / `groupAlias`. A link naming another app is
/// refused, and so is a pre-1.0 signed group invitation (it can't be redeemed
/// on a 1.0 cluster).
public struct TrackerInvitation: Sendable {
    public let invitation: OrgInvitation
    public let workspaceName: String?

    public init(invitation: OrgInvitation, workspaceName: String?) {
        self.invitation = invitation
        self.workspaceName = workspaceName
    }

    /// The org the invitation admits to.
    public var namespaceId: String { invitation.namespaceId }

    private struct Payload: Encodable {
        let invitation: String
        let namespaceId: String
        let contextId: String?
        let name: String?
        let groupAlias: String?
        let kind: String
    }

    /// The shareable token.
    public func token() throws -> String {
        let name = workspaceName ?? invitation.name
        return try InviteCodec.encode(
            Payload(
                invitation: invitation.token, namespaceId: invitation.namespaceId, contextId: invitation.contextId,
                name: name, groupAlias: name, kind: "namespace"))
    }

    /// The shareable link.
    public func link() throws -> String {
        InviteLink.invitation(token: try token(), slug: Tracker.packageName)
    }

    /// Read a link (https or `calimero://`) or a bare token; `nil` when it holds no tracker invitation.
    public static func parse(_ input: String) -> TrackerInvitation? {
        guard let token = InviteLink.token(fromPasted: input, expectedSlug: Tracker.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// Read the decoded payload JSON.
    public static func parse(json: String) -> TrackerInvitation? {
        guard let parsed = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return nil }
        let inner = parsed["data"] ?? parsed
        guard let token = inner["invitation"]?.stringValue, !token.isEmpty,
            let org = inner["namespaceId"]?.stringValue, !org.isEmpty
        else { return nil }
        let name = [inner["name"]?.stringValue, inner["groupName"]?.stringValue, inner["groupAlias"]?.stringValue]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty }
        let contextId = inner["contextId"]?.stringValue
        return TrackerInvitation(
            invitation: OrgInvitation(namespaceId: org, token: token, contextId: contextId, name: name),
            workspaceName: name)
    }
}
