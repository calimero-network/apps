import Foundation
import MeroKit

/// A workspace invitation in the web app's format (`app/src/utils/invitePayload.ts`
/// and `invitation.ts`), so a link minted on a phone opens in the browser and
/// the other way round:
///
/// - payload: `{"invitation": <SignedGroupOpenInvitation>, "groupAlias": "<workspace>", "groupId": "<hex>", "kind": "namespace"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-crm/join?invitation=<token>`
///
/// Decoding takes what the web's `parseInvitePayload` takes: the wrapped payload
/// or a bare signed invitation, under an optional `data` envelope, `groupName`
/// or `groupAlias`, the signature under either spelling. Another app's link is
/// refused, since redeeming it would join that app's namespace.
public struct CrmInvitation: Sendable {
    /// The registry package, which is also the links' slug (`APP_SLUG`).
    public static let packageName = "com.calimero.mero-crm"

    public let invitation: SignedGroupOpenInvitation
    public let workspaceName: String?
    /// The namespace it admits to: the signed `group_id`, else the payload's unsigned hint.
    public let namespaceId: String

    public init(invitation: SignedGroupOpenInvitation, workspaceName: String?) {
        self.invitation = invitation
        self.workspaceName = workspaceName
        self.namespaceId = Self.groupId(invitation) ?? ""
    }

    init(invitation: SignedGroupOpenInvitation, workspaceName: String?, namespaceId: String) {
        self.invitation = invitation
        self.workspaceName = workspaceName
        self.namespaceId = namespaceId
    }

    private static func groupId(_ invitation: SignedGroupOpenInvitation) -> String? {
        let bytes = invitation.invitation.groupId
        guard !bytes.isEmpty else { return nil }
        return Hex.encode(bytes.map { UInt8(truncatingIfNeeded: $0) })
    }

    private struct Payload: Encodable {
        let invitation: SignedGroupOpenInvitation
        let groupAlias: String?
        let groupId: String
        let kind: String
    }

    /// The shareable token.
    public func token() throws -> String {
        let name = workspaceName?.trimmingCharacters(in: .whitespacesAndNewlines)
        return try InviteCodec.encode(
            Payload(
                invitation: invitation, groupAlias: (name?.isEmpty ?? true) ? nil : name, groupId: namespaceId,
                kind: "namespace"))
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
        if let wrapped = inner["invitation"], isSigned(wrapped), let signed = decodeSigned(wrapped) {
            let name = [inner["groupAlias"]?.stringValue, inner["groupName"]?.stringValue]
                .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .first { !$0.isEmpty }
            let id = groupId(signed) ?? inner["groupId"]?.stringValue?.lowercased() ?? ""
            guard !id.isEmpty else { return nil }
            return CrmInvitation(invitation: signed, workspaceName: name, namespaceId: id)
        }
        if isSigned(inner), let signed = decodeSigned(inner), let id = groupId(signed) {
            return CrmInvitation(invitation: signed, workspaceName: nil, namespaceId: id)
        }
        return nil
    }

    /// A signature and an inner invitation object (the web's `isSignedInvitation`).
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
