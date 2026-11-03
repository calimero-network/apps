import Foundation
import MeroKit
import XCTest

/// The app's chat layer against a REAL Calimero 1.0 node: `merod local`
/// (`--dev`, mock attestation), nothing faked.
///
/// Every account signs up with a software passkey over the sealed channel
/// and reaches the node the 1.0 way: `/apps/{app}/views` for reads,
/// `/apps/{app}/intents` for writes, orgs and teams for workspaces and
/// channels, `/invites/{token}/redeem` for joins, sealed SSE for live
/// updates. The tests drive the app's own models (`WorkspacesModel`,
/// `ChannelsModel`, `ChannelModel`) and assert on what they publish.
///
/// Skipped unless `MERO_E2E_NODE_URL` is set (see ``LiveRig``).
@MainActor
final class ChatLiveTests: XCTestCase {
    // MARK: - 1. Founder flow

    /// Alice founds a workspace (real mock attestation, `#general` made as in
    /// production), then in `#general`: sends, pages history back through
    /// `/views`, edits, reacts and un-reacts, deletes, sets her name, and has
    /// nothing unread.
    func testFounderFlowAgainstTheNode() async throws {
        let rig = try LiveRig.require()
        let alice = try await LiveAccount.mint("alice", rig: rig)
        let founded = try await LiveScenario.foundWorkspace(alice, rig: rig)
        let general = founded.general

        let channel = ChannelModel(channel: general, backend: alice.backend, pageSize: 2, pollInterval: 60)
        await channel.loadInitial()
        XCTAssertNil(channel.errorText, "reading a new channel")
        XCTAssertTrue(channel.messages.isEmpty)
        XCTAssertFalse(channel.hasOlder)

        // Send three: each is a warrant on /intents, then a refresh through /query.
        let texts = ["one", "two", "three"].map { "\($0) \(UUID().uuidString.prefix(6))" }
        for text in texts {
            let sent = await channel.send(text)
            XCTAssertTrue(sent, "sending \(text): \(channel.errorText ?? "-")")
        }
        XCTAssertEqual(channel.messages.map(\.plainText), texts, "the sender's model shows its messages in order")
        XCTAssertTrue(channel.messages.allSatisfy { channel.isMine($0) }, "sent as Alice's UserId")

        // History paging: a fresh model with a page of 2 reads the newest two,
        // then the older one, with the web app's get_messages(limit, offset).
        let reopened = ChannelModel(channel: general, backend: alice.backend, pageSize: 2, pollInterval: 60)
        await reopened.loadInitial()
        XCTAssertNil(reopened.errorText)
        XCTAssertEqual(reopened.messages.map(\.plainText), Array(texts.suffix(2)), "the newest page")
        XCTAssertTrue(reopened.hasOlder, "an older message is left to page back to")
        await reopened.loadOlder()
        XCTAssertNil(reopened.errorText)
        XCTAssertEqual(reopened.messages.map(\.plainText), texts, "the whole channel after paging back")
        XCTAssertEqual(reopened.messages.map(\.index), [0, 1, 2], "stable indices, ascending")
        XCTAssertFalse(reopened.hasOlder, "nothing older than index 0")

        // Edit the oldest (not in the newest page): re-read by index.
        let first = try XCTUnwrap(LiveScenario.message(texts[0], in: reopened))
        let edited = "\(texts[0]) (edited)"
        await reopened.edit(first, to: edited)
        XCTAssertNil(reopened.errorText, "editing")
        let afterEdit = try XCTUnwrap(reopened.messages.first { $0.id == first.id })
        XCTAssertEqual(afterEdit.plainText, edited)
        XCTAssertNotNil(afterEdit.editedOn, "an edit is stamped")

        // React, then take the reaction back.
        let second = try XCTUnwrap(LiveScenario.message(texts[1], in: reopened))
        await reopened.toggleReaction("👍", on: second)
        XCTAssertNil(reopened.errorText, "reacting")
        let reacted = try XCTUnwrap(reopened.messages.first { $0.id == second.id })
        XCTAssertTrue(reacted.hasReaction("👍", by: reopened.me), "reactions: \(reacted.reactions)")
        await reopened.toggleReaction("👍", on: reacted)
        XCTAssertNil(reopened.errorText, "un-reacting")
        let unreacted = try XCTUnwrap(reopened.messages.first { $0.id == second.id })
        XCTAssertFalse(unreacted.hasReaction("👍", by: reopened.me), "reactions: \(unreacted.reactions)")

        // Delete the newest: blanked in place, its slot kept.
        let third = try XCTUnwrap(LiveScenario.message(texts[2], in: reopened))
        await reopened.delete(third)
        XCTAssertNil(reopened.errorText, "deleting")
        let deleted = try XCTUnwrap(reopened.messages.first { $0.id == third.id })
        XCTAssertTrue(deleted.deleted)
        XCTAssertEqual(deleted.text, "")
        XCTAssertEqual(deleted.index, third.index)
        XCTAssertEqual(reopened.messages.count, 3)

        // The name: none yet (created with an empty display name), then set.
        XCTAssertNil(reopened.myProfileName)
        let named = await reopened.setProfileName("Alice")
        XCTAssertTrue(named, "set_profile: \(reopened.errorText ?? "-")")
        XCTAssertEqual(reopened.myProfileName, "Alice")
        XCTAssertEqual(reopened.displayName(of: reopened.me), "Alice")

        // Own messages are never unread; the list shows no badge.
        let unread = try await ChatAPI(contract: alice.backend.contract).getUnreadCount(general.id)
        XCTAssertEqual(unread, 0)
        await founded.channels.load()
        XCTAssertNil(founded.channels.errorText)
        XCTAssertEqual(founded.channels.channels.first { $0.id == general.id }?.unread, 0)
    }

    // MARK: - 2. Invite + join

    /// Alice invites; Bob, a second offline account on his own device key,
    /// redeems the invite token on the node, lists the workspace
    /// and `#general`, joins it, reads Alice's message and replies; Alice reads
    /// the reply (and Bob's name), with an unread badge until she opens it.
    /// Bob cannot edit Alice's message: the app does not offer it, and the
    /// contract refuses it when asked directly, in words.
    func testInviteJoinAndReplyAcrossTwoAccounts() async throws {
        let rig = try LiveRig.require()
        let alice = try await LiveAccount.mint("alice", rig: rig)
        let founded = try await LiveScenario.foundWorkspace(alice, rig: rig)
        let general = founded.general

        let aliceChannel = ChannelModel(channel: general, backend: alice.backend, pollInterval: 60)
        await aliceChannel.loadInitial()
        let hello = "hello from Alice \(UUID().uuidString.prefix(6))"
        let sent = await aliceChannel.send(hello)
        XCTAssertTrue(sent, aliceChannel.errorText ?? "-")
        let aliceMessage = try XCTUnwrap(LiveScenario.message(hello, in: aliceChannel))

        let link = try await LiveScenario.invite(founded)
        let bob = try await LiveAccount.mint("bob", rig: rig)
        XCTAssertNotEqual(bob.accountId, alice.accountId)
        let bobSide = try await LiveScenario.join(
            bob, link: link, workspaceId: founded.workspace.id, channelId: general.id, displayName: "Bob", rig: rig)

        // Bob reads Alice's message.
        let bobChannel = ChannelModel(channel: bobSide.general, backend: bob.backend, pollInterval: 60)
        try await eventually("Bob reads Alice's message", detail: "\(bobChannel.messages.map(\.plainText))") {
            await bobChannel.loadInitial()
            return LiveScenario.message(hello, in: bobChannel) != nil
        }
        XCTAssertNil(bobChannel.errorText)
        let seenByBob = try XCTUnwrap(LiveScenario.message(hello, in: bobChannel))
        XCTAssertEqual(seenByBob.sender, alice.userId)
        XCTAssertFalse(bobChannel.isMine(seenByBob))
        // Opening the channel names him there, as ChannelScreen does: by the join
        // (ChannelsModel.join's set_profile), or, when namespace membership let
        // him in without one, by ensureProfile.
        await bobChannel.ensureProfile("Bob")
        XCTAssertEqual(bobChannel.myProfileName, "Bob")

        // Bob cannot edit Alice's message. The model does not even ask...
        await bobChannel.edit(seenByBob, to: "hijacked")
        XCTAssertNil(bobChannel.errorText, "editing someone else's message is not offered, so nothing is sent")
        // ...and the contract refuses when asked directly; the refusal reads as words.
        do {
            try await ChatAPI(contract: bob.backend.contract).editMessage(
                general.id, messageId: seenByBob.id, text: "hijacked")
            XCTFail("the contract let Bob edit Alice's message")
        } catch {
            let text = ChatErrorText.describe(error)
            XCTAssertTrue(
                text.contains("You can only edit your own messages"), "the contract's reason reaches the person: \(text)")
            let attachment = XCTAttachment(string: text)
            attachment.name = "The refusal of Bob's edit, as the app words it"
            attachment.lifetime = .keepAlways
            add(attachment)
        }

        // Bob replies, a second later than Alice last read (unread is strictly newer).
        try await Task.sleep(nanoseconds: 1_200_000_000)
        let reply = "hi Alice, Bob here \(UUID().uuidString.prefix(6))"
        let replied = await bobChannel.send(reply)
        XCTAssertTrue(replied, bobChannel.errorText ?? "-")

        // Alice's channel list badges it...
        try await eventually(
            "Alice's list shows an unread message", detail: "\(founded.channels.channels)"
        ) {
            await founded.channels.load()
            return (founded.channels.channels.first { $0.id == general.id }?.unread ?? 0) >= 1
        }
        // ...her open channel reads it, from Bob, under his name...
        try await eventually("Alice reads Bob's reply", detail: "\(aliceChannel.messages.map(\.plainText))") {
            await aliceChannel.refreshNewest()
            return LiveScenario.message(reply, in: aliceChannel) != nil
        }
        let fromBob = try XCTUnwrap(LiveScenario.message(reply, in: aliceChannel))
        XCTAssertEqual(fromBob.sender, bob.userId)
        XCTAssertFalse(aliceChannel.isMine(fromBob))
        await aliceChannel.loadProfiles()
        XCTAssertEqual(aliceChannel.displayName(of: bob.userId), "Bob")
        // ...and reading it clears the badge (mark_as_read on arrival).
        try await eventually("Alice's badge clears", detail: "\(founded.channels.channels)") {
            await founded.channels.load()
            return founded.channels.channels.first { $0.id == general.id }?.unread == 0
        }
        // Alice's message is still hers, unedited.
        XCTAssertEqual(aliceChannel.messages.first { $0.id == aliceMessage.id }?.plainText, hello)
    }

    // MARK: - 3. Live update

    /// Alice has `#general` open with live updates on (sealed SSE from the
    /// node); Bob sends; Alice's model shows it without her
    /// reading again, while the stream is still the live mechanism (not the
    /// polling fallback, which starts only if the stream ends).
    func testBobsMessageReachesAlicesOpenChannelLive() async throws {
        let rig = try LiveRig.require()
        let alice = try await LiveAccount.mint("alice", rig: rig)
        let founded = try await LiveScenario.foundWorkspace(alice, rig: rig)
        let link = try await LiveScenario.invite(founded)
        let bob = try await LiveAccount.mint("bob", rig: rig)
        let bobSide = try await LiveScenario.join(
            bob, link: link, workspaceId: founded.workspace.id, channelId: founded.general.id, displayName: "Bob",
            rig: rig)
        let bobChannel = ChannelModel(channel: bobSide.general, backend: bob.backend, pollInterval: 60)
        await bobChannel.loadInitial()
        XCTAssertNil(bobChannel.errorText)
        await bobChannel.ensureProfile("Bob")

        let open = ChannelModel(channel: founded.general, backend: alice.backend)
        await open.loadInitial()
        XCTAssertNil(open.errorText)
        XCTAssertTrue(alice.backend.canSubscribe, "a 1.0 session always streams")
        open.startLive()
        defer { open.stopLive() }
        XCTAssertEqual(open.liveStatus, .streaming)
        // Let the stream connect and subscribe before Bob writes.
        try await Task.sleep(nanoseconds: 3_000_000_000)

        let text = "live from Bob \(UUID().uuidString.prefix(6))"
        let sent = await bobChannel.send(text)
        XCTAssertTrue(sent, bobChannel.errorText ?? "-")

        // Only an event refreshes the open channel while it streams. If the
        // first send raced the subscription, a second one gives the stream
        // another event; either way the first message must show up.
        let started = Date()
        var resent = false
        var arrivedWhile: ChannelModel.LiveStatus?
        while Date().timeIntervalSince(started) < 30 {
            if LiveScenario.message(text, in: open) != nil {
                arrivedWhile = open.liveStatus
                break
            }
            if !resent, Date().timeIntervalSince(started) > 12 {
                resent = true
                _ = await bobChannel.send("\(text) (again)")
            }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        let status = try XCTUnwrap(
            arrivedWhile,
            "Bob's message did not reach Alice's open channel within 30s (live status \(open.liveStatus), "
                + "resent: \(resent), error: \(open.errorText ?? "-"))")
        XCTAssertEqual(
            status, .streaming, "the update arrived only after the node's event stream ended (polling fallback)")
        XCTAssertEqual(LiveScenario.message(text, in: open)?.sender, bob.userId)
    }
}
