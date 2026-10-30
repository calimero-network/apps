import Foundation
import MeroKit
import MeroKitTestSupport
import VoteCore
import VoteCrypto
import XCTest

@MainActor
final class GroupsModelTests: XCTestCase {
    func testListsWorkspacesWithTheirGroupsAndPollCounts() async {
        let (backend, script) = makeBackend()
        backend.namespaces = [AppNamespace(id: ns, name: "Design", applicationId: backend.applicationId)]
        backend.rootContexts = [ns: [ctx]]
        script.on("list_polls") { _ in
            [
                PollSummary(pollId: "p1", title: "Old", creator: me, phase: .closed, createdAt: 1, ballots: 3),
                PollSummary(pollId: "p2", title: "New", creator: me, phase: .voting, createdAt: 2, ballots: 0),
            ]
        }
        let model = GroupsModel(backend: backend, applicationId: backend.applicationId)
        await model.load()
        XCTAssertEqual(model.phase, .loaded)
        XCTAssertEqual(model.sections.map(\.name), ["Design"])
        let row = try? XCTUnwrap(model.sections.first?.groups.first)
        XCTAssertEqual(row?.ref.contextId, ctx)
        XCTAssertEqual(row?.polls, 2)
        XCTAssertEqual(row?.open, 1)
        XCTAssertEqual(row?.latest, "New")
        XCTAssertEqual(backend.recording.calls("list_polls").first?.path, .query)
    }

    func testNewWorkspaceFoundsItAndCreatesItsFirstGroup() async throws {
        let (backend, _) = makeBackend()
        let model = GroupsModel(backend: backend, applicationId: backend.applicationId)
        let ref = try await model.createWorkspace(name: "  Board  ")
        XCTAssertEqual(ref.workspaceName, "Board")
        XCTAssertEqual(backend.rootContexts[ref.namespaceId], [ref.contextId])
        XCTAssertEqual(backend.initArgs[ref.contextId], .object([:]))
        XCTAssertTrue(backend.log.contains("foundNamespace Board"))
        do {
            _ = try await model.createWorkspace(name: " ")
            XCTFail("an empty name must be refused")
        } catch {}
    }

    func testAnotherGroupGoesDirectlyInTheNamespace() async throws {
        let (backend, script) = makeBackend()
        script.on("list_polls") { _ in [PollSummary]() }
        backend.namespaces = [AppNamespace(id: ns, name: "Design", applicationId: backend.applicationId)]
        let model = GroupsModel(backend: backend, applicationId: "")
        await model.load()
        let ref = try await model.createGroup(in: try XCTUnwrap(model.sections.first))
        XCTAssertEqual(backend.rootContexts[ns], [ref.contextId])
        XCTAssertEqual(model.sections.first?.groups.map(\.ref.contextId), [ref.contextId])
    }

    func testFailureBeforeAnythingLoadedShowsAnError() async {
        let (backend, _) = makeBackend()
        backend.failure = Offline()
        let model = GroupsModel(backend: backend, applicationId: "")
        await model.load()
        guard case .failed = model.phase else { return XCTFail("expected a failed phase") }
    }
}

@MainActor
final class GroupModelTests: XCTestCase {
    private func scripted() -> (InMemoryAppBackend, Script, GroupModel) {
        let (backend, script) = makeBackend()
        script.on("whoami") { _ in Identity(account: me) }
        script.on("roster") { _ in [Member(account: bob, name: "Bob")] }
        script.on("list_polls") { _ in
            [
                PollSummary(pollId: "a", title: "A", creator: bob, phase: .keyCeremony, createdAt: 1, ballots: 0),
                PollSummary(pollId: "b", title: "B", creator: me, phase: .voting, createdAt: 2, ballots: 1),
            ]
        }
        return (backend, script, GroupModel(backend: backend, group: groupRef()))
    }

    func testRefreshReadsWhoRosterAndPollsNewestFirst() async {
        let (backend, _, model) = scripted()
        await model.refresh()
        XCTAssertEqual(model.me, me)
        XCTAssertEqual(model.polls.map(\.pollId), ["b", "a"])
        XCTAssertNil(model.myName)
        XCTAssertEqual(model.label(bob), "Bob")
        XCTAssertEqual(model.label(me), VoteFormat.short(me))
        XCTAssertEqual(model.people.map(\.account), [me, bob])
        XCTAssertEqual(model.count(.voting), 1)
        XCTAssertEqual(model.count(.closing, .closed), 0)
        XCTAssertEqual(backend.recording.calls("roster").first?.contextId, ctx)
    }

    func testSetNameTrimsAndSends() async throws {
        let (backend, script, model) = scripted()
        script.on("set_name") { _ in JSONValue.null }
        try await model.setName("  Ada ")
        XCTAssertEqual(backend.recording.calls("set_name").first?.string("name"), "Ada")
        XCTAssertEqual(backend.recording.calls("set_name").first?.path, .execute)
    }

    func testCreatePollSendsTheWebsArguments() async throws {
        let (backend, script, model) = scripted()
        script.on("create_poll") { _ in "poll-1" }
        await model.refresh()
        var draft = PollDraft(me: me, roster: model.roster)
        draft.title = " Lunch? "
        draft.options = ["Pizza", " ", "Sushi"]
        draft.trustees = [me, bob]
        XCTAssertEqual(draft.threshold, 2, "default is a majority")
        XCTAssertEqual(draft.trusteeNote(me: me)?.warning, false)
        let id = try await model.createPoll(draft)
        XCTAssertEqual(id, "poll-1")
        let call = try XCTUnwrap(backend.recording.calls("create_poll").first)
        XCTAssertEqual(call.string("title"), "Lunch?")
        XCTAssertEqual(try call.decode([String].self, "options"), ["Pizza", "Sushi"])
        XCTAssertEqual(call.args["min_choices"]?.intValue, 1)
        XCTAssertEqual(call.args["max_choices"]?.intValue, 1)
        XCTAssertEqual(call.args["threshold"]?.intValue, 2)
        XCTAssertEqual(try call.decode([String].self, "voters"), [])
        XCTAssertEqual(Set(try call.decode([String].self, "trustees")), [me, bob])

        draft.mode = .multi
        draft.maxChoices = 9
        draft.everyone = false
        draft.voters = [bob]
        _ = try await model.createPoll(draft)
        let multi = try XCTUnwrap(backend.recording.calls("create_poll").last)
        XCTAssertEqual(multi.args["min_choices"]?.intValue, 0)
        XCTAssertEqual(multi.args["max_choices"]?.intValue, 2, "clamped to the options filled in")
        XCTAssertEqual(try multi.decode([String].self, "voters"), [bob])
    }

    func testDuplicateOptionsAreRefusedBeforeSending() async {
        let (backend, _, model) = scripted()
        var draft = PollDraft(me: me, roster: [])
        draft.title = "Q"
        draft.options = ["Same", "Same"]
        do {
            _ = try await model.createPoll(draft)
            XCTFail("expected a refusal")
        } catch {}
        XCTAssertTrue(backend.recording.calls("create_poll").isEmpty)
    }

    func testInviteLinkIsTheSDKFormatAndNamesThisGroup() async throws {
        let (_, _, model) = scripted()
        let link = try await model.inviteLink()
        XCTAssertTrue(link.hasPrefix("https://links.calimero.network/com.calimero.mero-vote/join?invitation="))
        let parsed = try XCTUnwrap(VoteInvitation.parse(link))
        XCTAssertEqual(parsed.contextId, ctx)
        XCTAssertEqual(parsed.namespaceId, ns)
        let sdk = try XCTUnwrap(OrgInvitation.parse(link, expectedSlug: VoteConstants.packageName))
        XCTAssertEqual(sdk.namespaceId, ns)
        XCTAssertEqual(sdk.contextId, ctx)
    }

    func testRefusesPre10SignedInvitations() {
        let pre10 = #"{"invitation":{"invitation":{"group_id":[1]},"inviter_signature":"ff"},"namespaceId":"ab","contextId":"cd"}"#
        XCTAssertNil(VoteInvitation.parse(pre10))
        XCTAssertNil(VoteInvitation.parse(#"{"invitation":"inv_x","namespaceId":"ab"}"#), "no voting group named")
    }
}

@MainActor
final class InvitationModelTests: XCTestCase {
    func testRefusesAnotherAppsLink() async throws {
        let (backend, _) = makeBackend()
        let signed = try await backend.createInvitation(namespaceId: ns)
        let token = try VoteInvitation(invitation: signed, contextId: ctx).token()
        let model = InvitationModel(attempts: 1, retryDelay: .milliseconds(1))
        XCTAssertFalse(model.open("https://links.calimero.network/com.calimero.mero-forum/join?invitation=\(token)"))
        XCTAssertTrue(model.open("https://links.calimero.network/com.calimero.mero-vote/join?invitation=\(token)"))
        XCTAssertTrue(model.open("calimero://com.calimero.mero-vote/join?invitation=\(token)"))
        XCTAssertTrue(model.open(token))
    }

    func testJoinsTheWorkspaceThenOpensTheGroup() async throws {
        let (backend, _) = makeBackend()
        let signed = try await backend.createInvitation(namespaceId: ns)
        let link = try VoteInvitation(invitation: signed, contextId: ctx).link()
        let model = InvitationModel(attempts: 2, retryDelay: .milliseconds(1))
        XCTAssertTrue(model.open(link))
        XCTAssertEqual(model.stage, .confirm)
        var joined = false
        await model.accept(backend: { backend }, didJoin: { joined = true })
        XCTAssertTrue(joined)
        XCTAssertEqual(model.stage, .joined(GroupRef(namespaceId: ns, workspaceName: "Workspace", contextId: ctx)))
        XCTAssertTrue(backend.log.contains("joinNamespace \(ns)"))
        XCTAssertTrue(backend.members.contains(ctx))
    }

    func testAJoinFailureIsShown() async throws {
        let (backend, _) = makeBackend()
        let link = try VoteInvitation(invitation: try await backend.createInvitation(namespaceId: ns), contextId: ctx).link()
        backend.failure = Offline()
        let model = InvitationModel(attempts: 1, retryDelay: .milliseconds(1))
        model.open(link)
        await model.accept(backend: { backend }, didJoin: {})
        guard case .failed = model.stage else { return XCTFail("expected failure") }
    }
}

@MainActor
final class PollModelTests: XCTestCase {
    /// An election whose key is the vectors' (so its secret shares are known).
    private func vectorElection() -> (key: String, election: Election) {
        let key = Vectors.json["election_key"] as! String
        return (key, Election(key: key, threshold: 1, transport: [], qualified: [], disqualified: [], openedAt: 1))
    }

    func testCastSendsABallotThatVerifiesUnderTheVoter() async throws {
        let (backend, script) = makeBackend()
        let (key, election) = vectorElection()
        let def = definition()
        script.on("whoami") { _ in Identity(account: me) }
        script.on("get_poll") { _ in pollView(def, phase: .voting, election: election) }
        script.on("cast_ballot") { _ in "receipt" }
        let model = PollModel(backend: backend, group: groupRef(), pollId: pollId, keys: MemoryTrusteeKeyStore())
        await model.load()
        XCTAssertFalse(model.canCast, "nothing picked yet")
        model.toggle(2)
        model.toggle(1)
        XCTAssertEqual(model.selection, [false, true, false], "single choice keeps one")
        XCTAssertTrue(model.canCast)
        await model.cast()
        XCTAssertNil(model.error)
        XCTAssertNotNil(model.note)
        XCTAssertEqual(model.selection, [false, false, false], "the plaintext is forgotten")
        let call = try XCTUnwrap(backend.recording.calls("cast_ballot").first)
        XCTAssertEqual(call.path, .execute)
        let wire = try call.decode(WireBallot.self, "ballot")
        let ballot = try VoteWire.ballot(wire)
        let pk = try RistrettoPoint(hex: key)
        let rules = Rules(options: 3, min: 1, max: 1)
        XCTAssertNoThrow(try VoteProtocol.verifyBallot(pk: pk, pollId: pollId, voter: me, rules: rules, ballot: ballot))
        XCTAssertThrowsError(try VoteProtocol.verifyBallot(pk: pk, pollId: pollId, voter: bob, rules: rules, ballot: ballot))
    }

    func testTransportKeyIsKeptOnTheDeviceAndMatchesWhatIsPublished() async throws {
        let (backend, script) = makeBackend()
        let def = definition(trustees: [me, bob], threshold: 2)
        script.on("whoami") { _ in Identity(account: me) }
        script.on("get_poll") { _ in pollView(def, phase: .keyCeremony) }
        script.on("ceremony") { _ in
            Ceremony(threshold: 2, trustees: [CeremonyTrustee(account: me, index: 1), CeremonyTrustee(account: bob, index: 2)], complaints: [])
        }
        script.on("publish_transport_key") { _ in JSONValue.null }
        let store = MemoryTrusteeKeyStore()
        let model = PollModel(
            backend: backend, group: groupRef(), pollId: pollId, keys: store, rng: VoteProtocol.seededRngSendable("t"))
        await model.load()
        XCTAssertTrue(model.amTrustee)
        XCTAssertEqual(model.myIndex, 1)
        await model.publishTransportKey()
        let saved = try XCTUnwrap(store.load(contextId: ctx, pollId: pollId, account: me))
        let call = try XCTUnwrap(backend.recording.calls("publish_transport_key").first)
        let published = try RistrettoPoint(hex: try XCTUnwrap(call.string("key")))
        XCTAssertEqual(RistrettoPoint.base.multiply(try Scalar(hex: saved.secret)).hex, published.hex)
        let proof = try VoteWire.branch(try call.decode(WireBranch.self, "proof"))
        XCTAssertTrue(VoteProtocol.verifyTransportKey(pollId: pollId, trustee: me, key: published, proof: proof))
    }

    func testARefusedKeyStoreStopsBeforePublishing() async {
        let (backend, script) = makeBackend()
        script.on("whoami") { _ in Identity(account: me) }
        script.on("get_poll") { _ in pollView(definition(), phase: .keyCeremony) }
        script.on("ceremony") { _ in Ceremony(threshold: 1, trustees: [CeremonyTrustee(account: me, index: 1)], complaints: []) }
        let store = MemoryTrusteeKeyStore()
        store.refuses = true
        let model = PollModel(backend: backend, group: groupRef(), pollId: pollId, keys: store)
        await model.load()
        await model.publishTransportKey()
        XCTAssertNotNil(model.error)
        XCTAssertTrue(backend.recording.calls("publish_transport_key").isEmpty)
    }

    func testRestoreRefusesAKeyForAnotherPollOrAMismatchedSecret() async throws {
        let (backend, script) = makeBackend()
        let transport = Vectors.json["transport"] as! [[String: Any]]
        let mySecret = transport[0]["secret"] as! String
        let myKey = transport[0]["key"] as! String
        script.on("whoami") { _ in Identity(account: me) }
        script.on("get_poll") { _ in pollView(definition(trustees: [me, bob], threshold: 2), phase: .keyCeremony) }
        script.on("ceremony") { _ in
            Ceremony(
                threshold: 2,
                trustees: [CeremonyTrustee(account: me, index: 1, transport: myKey), CeremonyTrustee(account: bob, index: 2)],
                complaints: [])
        }
        let store = MemoryTrusteeKeyStore()
        let model = PollModel(backend: backend, group: groupRef(), pollId: pollId, keys: store)
        await model.load()
        let other = TrusteeKey(contextId: ctx, pollId: "another", account: me, secret: mySecret).json()
        XCTAssertThrowsError(try model.restoreKey(other))
        let wrong = TrusteeKey(contextId: ctx, pollId: pollId, account: me, secret: transport[1]["secret"] as! String).json()
        XCTAssertThrowsError(try model.restoreKey(wrong))
        XCTAssertThrowsError(try model.restoreKey("not json"))
        try model.restoreKey(TrusteeKey(contextId: ctx, pollId: pollId, account: me, secret: mySecret).json())
        XCTAssertEqual(model.trusteeKey?.secret, mySecret)
        XCTAssertNotNil(store.load(contextId: ctx, pollId: pollId, account: me))
    }

    func testPartialDecryptionIsTheWebsForTheSameSeed() async throws {
        // Alice (trustee 1) of the vectors' poll: deal, then decrypt the vectors' aggregate.
        let v = Vectors.json
        let vPoll = v["poll_id"] as! String
        let trustees = v["trustees"] as! [String]
        let transport = v["transport"] as! [[String: Any]]
        let alice = trustees[0]
        let (backend, script) = makeBackend(account: alice)
        let def = definition(trustees: trustees, threshold: 2, creator: alice)
        let qualified = try (v["dealings"] as! [[String: Any]]).map {
            QualifiedDealing(dealer: $0["dealer"] as! String, dealing: try Vectors.decode(WireDealing.self, $0["dealing"]!))
        }
        let election = Election(
            key: v["election_key"] as! String, threshold: 2, transport: transport.map { $0["key"] as! String },
            qualified: qualified, disqualified: [], openedAt: 1)
        script.on("whoami") { _ in Identity(account: alice) }
        script.on("get_poll") { _ in
            PollView(
                pollId: vPoll, definition: def, state: PollState(phase: .closed, election: election),
                trustees: trustees.enumerated().map { trusteeStatus($1, index: UInt32($0 + 1), transport: true, dealt: true) },
                turnout: [], canVote: true)
        }
        script.on("get_result") { _ in
            AuditReport(
                pollId: vPoll, phase: .closed, verified: true, checks: [], countedBallots: 5, decryptedBy: [], uncounted: [])
        }
        let aggregate = (v["aggregate"] as! [[String: String]]).map { WireCiphertext(a: $0["a"]!, b: $0["b"]!) }
        script.on("tally_inputs") { _ in TallyInputs(aggregate: aggregate, counted: 5) }
        script.on("publish_partial") { _ in JSONValue.null }
        let store = MemoryTrusteeKeyStore()
        _ = store.save(TrusteeKey(contextId: ctx, pollId: vPoll, account: alice, secret: transport[0]["secret"] as! String))
        let model = PollModel(
            backend: backend, group: groupRef(), pollId: vPoll, keys: store,
            rng: VoteProtocol.seededRngSendable(v["partials"].flatMap { ($0 as? [[String: Any]])?.first?["seed"] as? String } ?? ""))
        await model.load()
        XCTAssertNotNil(model.trusteeKey)
        await model.publishPartial(label: { $0 })
        XCTAssertNil(model.error)
        let call = try XCTUnwrap(backend.recording.calls("publish_partial").first)
        let partials = try call.decode([WirePartial].self, "partials")
        let expected = ((v["partials"] as! [[String: Any]])[0]["options"] as! [[String: Any]]).map { $0["d"] as! String }
        XCTAssertEqual(partials.map(\.d), expected, "the same partials the web computes from the same seed")
    }

    func testCreatorCeremonyStatusAndReverify() async throws {
        let (backend, script) = makeBackend()
        let honest = (Vectors.json["audits"] as! [[String: Any]]).first { $0["name"] as? String == "honest" }!
        let transcript = try Vectors.decode(Transcript.self, honest["transcript"]!)
        let def = definition(trustees: [me, bob], threshold: 2)
        script.on("whoami") { _ in Identity(account: me) }
        script.on("get_poll") { _ in
            pollView(def, phase: .keyCeremony, trustees: [
                trusteeStatus(me, index: 1, transport: true, dealt: true), trusteeStatus(bob, index: 2, transport: true),
            ])
        }
        script.on("ceremony") { _ in Ceremony(threshold: 2, trustees: [], complaints: []) }
        script.on("get_transcript") { _ in transcript }
        let model = PollModel(backend: backend, group: groupRef(), pollId: pollId, keys: MemoryTrusteeKeyStore())
        await model.load()
        XCTAssertTrue(model.isCreator)
        XCTAssertEqual(model.ceremonyStatus, "1 honest dealing so far; the key needs at least 2.")
        XCTAssertFalse(model.canOpenVoting)
        await model.reverify()
        XCTAssertEqual(model.localAudit?.verified, true)
        XCTAssertEqual(model.localAudit?.agreesWithNode, true)
    }
}
