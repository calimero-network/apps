import Foundation
import MeroKit

/// A workspace invitation in the form the web app shares (`app/src/utils/invitation.ts`):
///
/// - payload: JSON `{"invitation": <SignedGroupOpenInvitation>, "groupAlias": "<name>"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.chat/join?invitation=<token>`
///
/// Decoding takes everything the web app's `parseGroupInvitationPayload`
/// takes: the wrapped payload or a bare signed invitation, under an optional
/// `data` envelope, with `groupName` preferred over `groupAlias`, and the
/// signature under `inviter_signature` or `inviterSignature`. A link, a
/// `calimero://` link or a bare token all work; a link naming another app is
/// refused, since redeeming it would join that app's namespace.
struct ChatInvitation: Sendable {
    let invitation: SignedGroupOpenInvitation
    let workspaceName: String?

    /// The namespace the invitation admits to: the hex of its signed `group_id`.
    var namespaceId: String {
        Hex.encode(invitation.invitation.groupId.map { UInt8(truncatingIfNeeded: $0) })
    }

    // MARK: Encoding

    private struct Payload: Encodable {
        let invitation: SignedGroupOpenInvitation
        let groupAlias: String?
    }

    /// The shareable token.
    func token() throws -> String {
        try InviteCodec.encode(Payload(invitation: invitation, groupAlias: workspaceName))
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
        if let wrapped = inner["invitation"], isSignedInvitation(wrapped),
            let signed = decodeSigned(wrapped)
        {
            let name = inner["groupName"]?.stringValue ?? inner["groupAlias"]?.stringValue
            return ChatInvitation(invitation: signed, workspaceName: name)
        }
        if isSignedInvitation(inner), let signed = decodeSigned(inner) {
            return ChatInvitation(invitation: signed, workspaceName: nil)
        }
        return nil
    }

    /// The web app's `isSignedGroupOpenInvitation`: a signature and an inner invitation object.
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
