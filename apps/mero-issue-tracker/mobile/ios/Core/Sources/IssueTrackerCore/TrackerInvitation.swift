import Foundation
import MeroKit

/// A workspace invitation in the web app's form (`app/src/utils/invitePayload.ts`):
///
/// - payload: `{"invitation": <SignedGroupOpenInvitation>, "groupAlias": "<name>", "groupId": "<hex>", "kind": "namespace"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-issue-tracker/join?invitation=<token>`
///
/// Reading takes the wrapped payload or a bare signed invitation, under an optional
/// `data` envelope, with `groupName` preferred over `groupAlias`. The namespace is
/// always read from the signed body, never from the unsigned `groupId` hint. A link
/// naming another app is refused: redeeming it would join that app's namespace.
public struct TrackerInvitation: Sendable {
    public let invitation: SignedGroupOpenInvitation
    public let workspaceName: String?

    public init(invitation: SignedGroupOpenInvitation, workspaceName: String?) {
        self.invitation = invitation
        self.workspaceName = workspaceName
    }

    /// The namespace the invitation admits to: the hex of its signed `group_id`.
    public var namespaceId: String {
        Hex.encode(invitation.invitation.groupId.map { UInt8(truncatingIfNeeded: $0) })
    }

    private struct Payload: Encodable {
        let invitation: SignedGroupOpenInvitation
        let groupAlias: String?
        let groupId: String
        let kind: String
    }

    /// The shareable token.
    public func token() throws -> String {
        try InviteCodec.encode(
            Payload(invitation: invitation, groupAlias: workspaceName, groupId: namespaceId, kind: "namespace"))
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
        if let wrapped = inner["invitation"], isSigned(wrapped), let signed = decodeSigned(wrapped) {
            let name = [inner["groupName"]?.stringValue, inner["groupAlias"]?.stringValue]
                .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
                .first { !$0.isEmpty }
            return TrackerInvitation(invitation: signed, workspaceName: name)
        }
        if isSigned(inner), let signed = decodeSigned(inner) {
            return TrackerInvitation(invitation: signed, workspaceName: nil)
        }
        return nil
    }

    private static func isSigned(_ value: JSONValue) -> Bool {
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
