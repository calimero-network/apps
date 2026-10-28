import Foundation
import MeroKit

/// A team invitation in the web app's form (`app/src/pages/teams/TeamsPage.tsx`,
/// `components/common/invitation-prompt/InvitationPrompt.tsx`):
///
/// - payload: `{"invitation": <SignedGroupOpenInvitation>, "__teamName": "<name>"}`
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-calendar/join?invitation=<token>`
///
/// Reading accepts what the web app's `parseTeamInvitation` accepts: the
/// wrapped payload or a bare signed invitation, the name under `__teamName`
/// (or `groupName` / `groupAlias`), a link, a `calimero://` link or a bare token.
public struct TeamInvitation: Sendable {
    public let invitation: SignedGroupOpenInvitation
    public let teamName: String?

    public init(invitation: SignedGroupOpenInvitation, teamName: String?) {
        self.invitation = invitation
        self.teamName = teamName
    }

    /// The namespace it admits to: the hex of its signed `group_id`.
    public var namespaceId: String {
        Hex.encode(invitation.invitation.groupId.map { UInt8(truncatingIfNeeded: $0) })
    }

    private struct Payload: Encodable {
        let invitation: SignedGroupOpenInvitation
        let teamName: String?
        enum CodingKeys: String, CodingKey {
            case invitation
            case teamName = "__teamName"
        }
    }

    /// The shareable link.
    public func link() throws -> String {
        let token = try InviteCodec.encode(Payload(invitation: invitation, teamName: teamName))
        return InviteLink.invitation(token: token, slug: CalendarConstants.packageName)
    }

    /// Read a pasted link, a deep link or a bare token; `nil` when it is no
    /// Mero Calendar invitation (another app's link is refused).
    public static func parse(_ input: String) -> TeamInvitation? {
        guard let token = InviteLink.token(fromPasted: input, expectedSlug: CalendarConstants.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// Read the decoded payload JSON.
    public static func parse(json: String) -> TeamInvitation? {
        guard let root = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return nil }
        let payload = root["data"] ?? root
        let name = ["__teamName", "groupName", "groupAlias"].lazy
            .compactMap { payload[$0]?.stringValue?.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty }
        if let wrapped = payload["invitation"], isSigned(wrapped), let signed = decode(wrapped) {
            return TeamInvitation(invitation: signed, teamName: name)
        }
        if isSigned(payload), let signed = decode(payload) {
            return TeamInvitation(invitation: signed, teamName: name)
        }
        return nil
    }

    private static func isSigned(_ value: JSONValue) -> Bool {
        guard case .object(let fields) = value, case .object? = fields["invitation"] else { return false }
        return fields["inviter_signature"]?.stringValue != nil || fields["inviterSignature"]?.stringValue != nil
    }

    private static func decode(_ value: JSONValue) -> SignedGroupOpenInvitation? {
        guard case .object(var fields) = value else { return nil }
        if fields["inviter_signature"] == nil, let camel = fields["inviterSignature"] {
            fields["inviter_signature"] = camel
            fields.removeValue(forKey: "inviterSignature")
        }
        guard let data = try? JSONEncoder().encode(JSONValue.object(fields)) else { return nil }
        return try? JSONDecoder().decode(SignedGroupOpenInvitation.self, from: data)
    }
}
