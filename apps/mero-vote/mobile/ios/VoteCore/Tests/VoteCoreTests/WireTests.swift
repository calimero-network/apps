import Foundation
import MeroKit
import MeroKitTestSupport
import VoteCore
import XCTest

/// The client speaks the component ABI the web adapter (`app/src/meroVote.ts`) speaks.
final class WireTests: XCTestCase {
    /// The contract's calls and views, as `logic/res/abi.json` names them on Calimero 1.0.
    static let calls = [
        "setName", "createPoll", "publishTransportKey", "publishDealing", "fileComplaint", "openVoting", "castBallot",
        "closePoll", "sealPoll", "publishPartial", "anchorResult",
    ]
    static let views = [
        "whoami", "roster", "listPolls", "getPoll", "ceremony", "tallyInputs", "getResult", "getTranscript",
    ]

    func testEveryMethodGoesOutCamelCaseWithPollId() async throws {
        let (backend, script) = makeBackend()
        for method in Self.calls + Self.views { script.raw(method) { _ in Data("null".utf8) } }
        let client = VoteClient.make(contract: backend.contract, contextId: ctx)
        let branch = try JSONValue(encoding: WireBranch(c: "00", z: "00"))
        _ = try? await client.whoami().decoded(as: Identity.self)
        _ = try? await client.roster().map({ try $0.decoded(as: Member.self) })
        _ = try? await client.listPolls().map({ try $0.decoded(as: PollSummary.self) })
        _ = try? await client.getPoll(pollId: pollId).decoded(as: PollView.self)
        _ = try? await client.ceremony(pollId: pollId).decoded(as: Ceremony.self)
        _ = try? await client.tallyInputs(pollId: pollId).decoded(as: TallyInputs.self)
        _ = try? await client.getResult(pollId: pollId).decoded(as: AuditReport.self)
        _ = try? await client.getTranscript(pollId: pollId).decoded(as: Transcript.self)
        try await client.setName(name: "Ada")
        _ = try? await client.createPoll(
            title: "Q", description: "", options: ["A", "B"], minChoices: 1, maxChoices: 1, trustees: [me], threshold: 1,
            voters: [])
        try await client.publishTransportKey(pollId: pollId, key: "00", proof: branch)
        try await client.publishDealing(
            pollId: pollId,
            dealing: try JSONValue(encoding: WireDealing(commitments: [], proof: WireBranch(c: "00", z: "00"), shares: [])))
        try await client.fileComplaint(pollId: pollId, dealer: bob, secret: "00", proof: branch)
        _ = try? await client.openVoting(pollId: pollId)
        _ = try? await client.castBallot(pollId: pollId, ballot: try JSONValue(encoding: WireBallot(choices: [], sumProof: [])))
        try await client.closePoll(pollId: pollId)
        _ = try? await client.sealPoll(pollId: pollId)
        try await client.publishPartial(pollId: pollId, partials: [])
        _ = try? await client.anchorResult(pollId: pollId, network: "n", reference: "r")

        for method in Self.calls {
            let call = try XCTUnwrap(backend.recording.calls(method).first, method)
            XCTAssertEqual(call.path, .execute, method)
        }
        for method in Self.views {
            let call = try XCTUnwrap(backend.recording.calls(method).first, method)
            XCTAssertEqual(call.path, .query, method)
        }
        for method in Self.calls + Self.views where !["whoami", "roster", "listPolls", "setName", "createPoll"].contains(method) {
            let call = try XCTUnwrap(backend.recording.calls(method).first)
            XCTAssertEqual(call.string("pollId"), pollId, method)
            XCTAssertNil(call.args["poll_id"], method)
        }
    }

    func testClosesAtIsADecimalStringOrNull() async throws {
        let (backend, script) = makeBackend()
        script.on("createPoll") { _ in "p" }
        let client = VoteClient.make(contract: backend.contract, contextId: ctx)
        _ = try await client.createPoll(
            title: "Q", description: "", options: ["A", "B"], minChoices: 0, maxChoices: 2, trustees: [me], threshold: 1,
            voters: [], closesAt: 1_761_000_000_123)
        _ = try await client.createPoll(
            title: "Q", description: "", options: ["A", "B"], minChoices: 0, maxChoices: 2, trustees: [me], threshold: 1,
            voters: [])
        let calls = backend.recording.calls("createPoll")
        XCTAssertEqual(calls.first?.args["closesAt"], .string("1761000000123"))
        XCTAssertEqual(calls.first?.args["minChoices"]?.intValue, 0)
        XCTAssertEqual(calls.last?.args["closesAt"], .null)
        XCTAssertNil(calls.first?.args["closes_at"])
    }

    func testU64AnswersArriveAsDecimalStrings() async throws {
        let (backend, script) = makeBackend()
        script.raw("listPolls") { _ in
            Data(
                #"[{"poll_id":"p","title":"T","creator":"c","phase":"Voting","created_at":"1761000000123","ballots":2}]"#
                    .utf8)
        }
        let client = VoteClient.make(contract: backend.contract, contextId: ctx)
        let polls = try await client.listPolls().map({ try $0.decoded(as: PollSummary.self) })
        XCTAssertEqual(polls.first?.createdAt, 1_761_000_000_123)
        XCTAssertEqual(polls.first?.ballots, 2)

        let closure = try VoteWireDecoding.decode(
            Closure.self,
            from: Data(
                #"{"counted":[{"voter":"v","digest":"d","frozen":"f"}],"aggregate":[{"a":"01","b":"02"}],"closed_at":"42"}"#
                    .utf8))
        XCTAssertEqual(closure.closedAt, 42)
        XCTAssertEqual(closure.aggregate, [WireCiphertext(a: "01", b: "02")])
        // A title that happens to look like a number is not touched: only the u64 fields are.
        XCTAssertEqual(
            try VoteWireDecoding.decode([String: String].self, from: Data(#"{"title":"123"}"#.utf8)), ["title": "123"])
    }

    func testTheContractsRefusalsReadAsPlainWords() {
        func app(_ code: String, _ message: String? = nil) -> AppError {
            var fields: [String: JSONValue] = [:]
            if let message { fields["message"] = .string(message) }
            return AppError("app error", details: ["code": .string(code), "fields": .object(fields)])
        }
        XCTAssertEqual(
            VoteErrorText.describe(app("Phase", "voting is closed")),
            "The poll has moved on to another step. Voting is closed.")
        XCTAssertEqual(VoteErrorText.describe(app("NotFound")), "That poll isn't in this voting group.")
        XCTAssertTrue(VoteErrorText.describe(app("Forbidden", "not a trustee")).hasPrefix("You can't do that"))
        XCTAssertEqual(VoteErrorText.describe(app("Invalid", "too many options")), "Too many options.")
        XCTAssertEqual(VoteErrorText.describe(ConfirmCancelled()), "You cancelled the passkey prompt, so nothing changed.")
        XCTAssertEqual(VoteErrorText.describe(LoginRequired("expired")), "Your session ended. Sign in again.")
        XCTAssertTrue(
            VoteErrorText.describe(ReleaseDeadlineError("x", details: ["release": .string("1.2.0")])).contains("1.2.0"))
        XCTAssertTrue(VoteErrorText.describe(ConsentStale("x")).contains("already decided"))
        XCTAssertTrue(VoteErrorText.describe(WrongNode("x")).contains("can't serve"))
    }

    func testABallotMustVerifyInOneCall() {
        var draft = PollDraft(me: me, roster: [])
        draft.title = "Q"
        draft.options = (1...16).map { "Option \($0)" }
        XCTAssertTrue(draft.fitsOneBallot, "a single choice among 16 is 33 branches")
        draft.mode = .multi
        draft.maxChoices = 16
        XCTAssertFalse(draft.fitsOneBallot, "16 options, up to 16 picks: 49 branches")
        draft.maxChoices = 5
        XCTAssertTrue(draft.fitsOneBallot)
    }
}
