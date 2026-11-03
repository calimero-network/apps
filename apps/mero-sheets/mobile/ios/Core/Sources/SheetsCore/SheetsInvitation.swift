import Foundation
import MeroKit

/// A workspace invitation: Calimero 1.0's org invite token in the SDK's link
/// shape (``OrgInvitation``), plus the spreadsheet that was open:
///
/// - payload: `{"invitation": "inv_…", "namespaceId": "<org>", "name": "<workspace>",
///   "contextId": "<spreadsheet>", "projectName": "<name>", "roomName": "<name>"}`
///   (the last three only when the invite names the spreadsheet that was open)
/// - token: `base58(deflate(payload))` (``InviteCodec``)
/// - link: `https://links.calimero.network/com.calimero.mero-sheets/join?invitation=<token>`
///
/// Reading takes an optional `data` envelope, and `groupName` / `groupAlias` for
/// the name. The token is a bearer secret the org's node minted; redeeming it
/// (`POST /invites/{token}/redeem`) joins the org it belongs to. The spreadsheet is
/// only a hint for what to open after joining. A link naming another app is
/// refused, and so is a pre-1.0 signed invitation (a 1.0 cluster cannot redeem it).
public struct SheetsInvitation: Sendable {
    public let invitation: OrgInvitation
    public let workspaceName: String?
    /// The spreadsheet open when the invite was made: opened after joining.
    public let contextId: String?
    public let spreadsheetName: String?

    public init(
        invitation: OrgInvitation, workspaceName: String?, contextId: String? = nil, spreadsheetName: String? = nil
    ) {
        self.invitation = invitation
        self.workspaceName = workspaceName
        self.contextId = contextId
        self.spreadsheetName = spreadsheetName
    }

    /// The org (workspace) the invitation admits to.
    public var namespaceId: String { invitation.namespaceId }

    /// The shareable token: the SDK's ``OrgInvitation`` JSON with the spreadsheet's name beside it.
    public func token() throws -> String {
        let base = OrgInvitation(
            namespaceId: invitation.namespaceId, token: invitation.token, contextId: Self.nonEmpty(contextId),
            name: Self.nonEmpty(workspaceName))
        guard case .object(var payload) = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(base))
        else { return try base.encoded() }
        if let name = Self.nonEmpty(spreadsheetName) {
            payload["projectName"] = .string(name)
            payload["roomName"] = .string(name)
        }
        return try InviteCodec.encode(JSONValue.object(payload))
    }

    /// The shareable link.
    public func link() throws -> String {
        InviteLink.invitation(token: try token(), slug: MeroSheets.packageName)
    }

    /// Read a link (https or `calimero://`) or a bare token; `nil` when it holds no tracker invitation.
    public static func parse(_ input: String) -> SheetsInvitation? {
        guard let token = InviteLink.token(fromPasted: input, expectedSlug: MeroSheets.packageName),
            let json = InviteCodec.decode(token: token)
        else { return nil }
        return parse(json: json)
    }

    /// Read the decoded payload JSON.
    public static func parse(json: String) -> SheetsInvitation? {
        guard let parsed = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return nil }
        let inner = parsed["data"] ?? parsed
        guard let data = try? JSONEncoder().encode(inner),
            let base = try? JSONDecoder().decode(OrgInvitation.self, from: data)
        else { return nil }
        let name = [base.name, inner["groupName"]?.stringValue, inner["groupAlias"]?.stringValue]
            .compactMap { nonEmpty($0) }
            .first
        let project = [inner["projectName"]?.stringValue, inner["roomName"]?.stringValue]
            .compactMap { nonEmpty($0) }
            .first
        return SheetsInvitation(
            invitation: base, workspaceName: name, contextId: nonEmpty(base.contextId), spreadsheetName: project)
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespaces), !value.isEmpty else { return nil }
        return value
    }
}
