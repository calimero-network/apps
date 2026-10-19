import Foundation
import MeroKit

/// Contract outputs, in the exact shapes `logic/src/lib.rs` serializes.
///
/// The message shapes follow `MessageWithReactions` / `FullMessageResponse`
/// field for field (serde, snake_case, `Option` as `null`, `UserId` as base58,
/// `MessageId` as `<sha256 hex>_<timestamp>`); `Message` is what
/// `send_message` / `edit_message` return through its hand-written
/// `Serialize`. The invitation is a capture from a live `merod`
/// (swift-sdk `Tests/MeroKitTests/Fixtures/rc32-namespace-invitation.json`,
/// its `data.invitation`).
enum ChatFixtures {
    /// The signed-in account (hex) and its `UserId` (base58 of the same bytes).
    static let account = "96c8a97ab268d076ed1f662138b330b2edff5a4159775eca4a383b3e5918f3e4"
    static var myUserId: String { ChatIdentity.userId(accountHex: account) ?? "" }
    /// Another member's `UserId`.
    static let bob = "8k7Y3vEeQ2qGv4T1YwW5cB2f9tRkJ1nVxS6dLmPqZr3A"

    static let channelId = "81bdde80b997839f282072874e508569ecb4658bfe80c979322821c220dfd41f"
    static let namespaceId = "143699541ebbc5915f90eb5d50d26831350a5ea65b294e576c7cf0f4b8a04f3b"

    static func messageId(_ n: Int, timestamp: UInt64) -> String {
        String(format: "%064lx", n) + "_\(timestamp)"
    }

    /// One `MessageWithReactions`, as serde writes it.
    static func messageJSON(
        index: UInt64, sender: String, text: String, timestamp: UInt64 = 1_760_000_000,
        reactions: String = "null", deleted: String = "null", editedOn: String = "null"
    ) -> String {
        """
        {"index":\(index),"timestamp":\(timestamp + index),"sender":"\(sender)","mentions":[],\
        "mentions_usernames":[],"files":[],"images":[],"id":"\(messageId(Int(index), timestamp: timestamp + index))",\
        "text":"\(text)","edited_on":\(editedOn),"reactions":\(reactions),"deleted":\(deleted),\
        "thread_count":0,"thread_last_timestamp":0,"parent_message_id":null}
        """
    }

    /// A `FullMessageResponse` holding `indices` of a channel `total` long.
    static func pageJSON(total: Int, indices: [UInt64], offset: Int, sender: String = bob) -> String {
        let messages = indices.map { messageJSON(index: $0, sender: sender, text: "message \($0)") }
        return #"{"total_count":\#(total),"messages":[\#(messages.joined(separator: ","))],"start_position":\#(offset)}"#
    }

    /// The page `get_messages(limit, offset)` returns from a channel of `total`
    /// messages: the window counted back from the end (`page_window`).
    static func windowJSON(total: Int, limit: Int, offset: Int, sender: String = bob) -> String {
        guard offset < total else { return pageJSON(total: total, indices: [], offset: offset, sender: sender) }
        let end = total - offset
        let start = max(0, end - limit)
        return pageJSON(total: total, indices: (start..<end).map { UInt64($0) }, offset: offset, sender: sender)
    }

    /// `ContextInfo` for a channel.
    static let channelInfoJSON = """
        {"name":"general","context_type":"Channel","description":"","created_at":1760000000,\
        "creator":"8k7Y3vEeQ2qGv4T1YwW5cB2f9tRkJ1nVxS6dLmPqZr3A"}
        """

    /// `get_profiles`.
    static var profilesJSON: String {
        """
        [{"identity":"\(myUserId)","username":"alice","avatar":null},\
        {"identity":"\(bob)","username":"bob","avatar":null}]
        """
    }

    /// `send_message`'s return: the contract's `Message`.
    static let sentMessageJSON = """
        {"timestamp":1760000100,"sender":"8k7Y3vEeQ2qGv4T1YwW5cB2f9tRkJ1nVxS6dLmPqZr3A","mentions":[],\
        "mentions_usernames":[],"files":[],"images":[],\
        "id":"0000000000000000000000000000000000000000000000000000000000000063_1760000100",\
        "text":"hello","edited_on":null,"deleted":null}
        """

    /// A namespace invitation captured from a live merod (rc32).
    static let signedInvitationJSON = """
        {"invitation":{"inviter_identity":[63,105,14,241,166,192,192,156,59,95,153,139,36,167,141,100,35,20,71,150,\
        87,77,17,3,100,112,61,153,38,18,159,195],"group_id":[20,54,153,84,30,187,197,145,95,144,235,93,80,210,104,49,\
        53,10,94,166,91,41,78,87,108,124,240,244,184,160,79,59],"expiration_timestamp":1789039164,"secret_salt":[9,74,\
        107,3,169,44,105,237,187,80,193,38,14,227,132,127,145,93,5,132,47,182,166,100,86,60,193,0,174,159,104,168],\
        "invited_role":1,"admitters":["96c8a97ab268d076ed1f662138b330b2edff5a4159775eca4a383b3e5918f3e4"]},\
        "inviter_signature":"80ff4f749dfb31bf3ab1b85d14d2e3038a183384e0b6bfd495ed36b204dc40fa0909a41fdb7951ea50a72f\
        2eec5e40d48a59e8f4a39f9bc3a71df6a516898702","inviter_account":"96c8a97ab268d076ed1f662138b330b2edff5a4159775\
        eca4a383b3e5918f3e4","admitter_addrs":["/ip4/10.0.0.7/tcp/4102/p2p/12D3KooWCdWRrkvjmXn1uQjodhfioKaGQtpBTR7TMo\
        KEGf63Txxs"],"application_id":[63,85,2,83,179,239,67,192,43,54,151,255,38,177,126,142,33,160,210,219,117,166,\
        255,88,50,254,118,57,226,89,110,34],"app_key":[227,72,196,27,24,58,17,237,199,13,29,234,9,145,72,7,117,17,147,\
        151,89,7,130,139,78,42,174,163,58,39,180,126]}
        """

    static func signedInvitation() throws -> SignedGroupOpenInvitation {
        try JSONDecoder().decode(SignedGroupOpenInvitation.self, from: Data(signedInvitationJSON.utf8))
    }
}
