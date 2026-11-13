package network.calimero.vote.core

import com.calimero.mero.AppError
import com.calimero.mero.ConfirmCancelled
import com.calimero.mero.ConsentStale
import com.calimero.mero.LoginRequired
import com.calimero.mero.ReleaseDeadlineError
import com.calimero.mero.WrongNode
import com.calimero.mero.testkit.RecordedContractCall
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import network.calimero.vote.generated.AuditReport
import network.calimero.vote.generated.Ceremony
import network.calimero.vote.generated.Closure
import network.calimero.vote.generated.Identity
import network.calimero.vote.generated.Member
import network.calimero.vote.generated.PollSummary
import network.calimero.vote.generated.PollView
import network.calimero.vote.generated.TallyInputs
import network.calimero.vote.generated.Transcript
import network.calimero.vote.generated.VoteWireDecoding
import network.calimero.vote.generated.WireBallot
import network.calimero.vote.generated.WireBranch
import network.calimero.vote.generated.WireCiphertext
import network.calimero.vote.generated.WireDealing
import network.calimero.vote.generated.asContractArg
import network.calimero.vote.generated.toVote
import network.calimero.vote.generated.toVoteJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The client speaks the component ABI the web adapter (`app/src/meroVote.ts`) speaks. (Swift `WireTests`.) */
class WireTest {
    private val calls =
        listOf(
            "setName", "createPoll", "publishTransportKey", "publishDealing", "fileComplaint", "openVoting", "castBallot",
            "closePoll", "sealPoll", "publishPartial", "anchorResult",
        )
    private val views = listOf("whoami", "roster", "listPolls", "getPoll", "ceremony", "tallyInputs", "getResult", "getTranscript")

    @Test
    fun `every method goes out camelCase with pollId`() =
        runTest {
            val (backend, _) = makeBackend()
            val client = voteClient(backend.contract, CTX)
            val branch = WireBranch("00", "00")
            val poll = "dd".repeat(32)
            runCatching { client.whoami().toVote<Identity>() }
            runCatching { client.roster().map { it.toVote<Member>() } }
            runCatching { client.listPolls().map { it.toVote<PollSummary>() } }
            runCatching { client.getPoll(poll).toVote<PollView>() }
            runCatching { client.ceremony(poll).toVote<Ceremony>() }
            runCatching { client.tallyInputs(poll).toVote<TallyInputs>() }
            runCatching { client.getResult(poll).toVote<AuditReport>() }
            runCatching { client.getTranscript(poll).toVote<Transcript>() }
            client.setName("Ada")
            runCatching { client.createPoll("Q", "", listOf("A", "B"), 1u, 1u, listOf(ME), 1u, emptyList()) }
            client.publishTransportKey(poll, "00", branch.toVoteJson().asContractArg())
            client.publishDealing(poll, WireDealing(emptyList(), branch, emptyList()).toVoteJson().asContractArg())
            client.fileComplaint(poll, BOB, "00", branch.toVoteJson().asContractArg())
            runCatching { client.openVoting(poll) }
            runCatching { client.castBallot(poll, WireBallot(emptyList(), emptyList()).toVoteJson().asContractArg()) }
            client.closePoll(poll)
            runCatching { client.sealPoll(poll) }
            client.publishPartial(poll, emptyList())
            runCatching { client.anchorResult(poll, "n", "r") }

            for (method in calls) {
                assertEquals(
                    method, RecordedContractCall.Path.EXECUTE,
                    backend.recording
                        .calls(method)
                        .single()
                        .path,
                )
            }
            for (method in views) {
                assertEquals(
                    method, RecordedContractCall.Path.QUERY,
                    backend.recording
                        .calls(method)
                        .single()
                        .path,
                )
            }
            for (method in calls + views - setOf("whoami", "roster", "listPolls", "setName", "createPoll")) {
                val call = backend.recording.calls(method).single()
                assertEquals(method, poll, call.string("pollId"))
                assertNull(method, call.arg("poll_id"))
            }
        }

    @Test
    fun `closesAt is a decimal string or left out`() =
        runTest {
            val (backend, script) = makeBackend()
            script.on("createPoll") { "p" }
            val client = voteClient(backend.contract, CTX)
            client.createPoll("Q", "", listOf("A", "B"), 0u, 2u, listOf(ME), 1u, emptyList(), 1_761_000_000_123uL)
            client.createPoll("Q", "", listOf("A", "B"), 0u, 2u, listOf(ME), 1u, emptyList())
            val sent = backend.recording.calls("createPoll")
            assertEquals(JsonPrimitive("1761000000123"), sent.first().arg("closesAt"))
            assertEquals("0", sent.first().string("minChoices"))
            assertNull(sent.last().arg("closesAt"))
            assertNull(sent.first().arg("closes_at"))
        }

    @Test
    fun `u64 answers arrive as decimal strings`() =
        runTest {
            val (backend, script) = makeBackend()
            script.put("listPolls") {
                Json.parseToJsonElement(
                    """[{"poll_id":"p","title":"T","creator":"c","phase":"Voting","created_at":"1761000000123","ballots":2}]""",
                )
            }
            val polls = voteClient(backend.contract, CTX).listPolls().map { it.toVote<PollSummary>() }
            assertEquals(1_761_000_000_123uL, polls.single().createdAt)
            assertEquals(2u, polls.single().ballots)

            val closure =
                VoteWireDecoding.decode(
                    Closure.serializer(),
                    """{"counted":[{"voter":"v","digest":"d","frozen":"f"}],"aggregate":[{"a":"01","b":"02"}],"closed_at":"42"}""",
                )
            assertEquals(42uL, closure.closedAt)
            assertEquals(listOf(WireCiphertext("01", "02")), closure.aggregate)
            // Only the u64 fields are touched: a title that looks like a number stays a string.
            assertEquals(
                JsonPrimitive("123"),
                VoteWireDecoding.normalized(Json.parseToJsonElement("""{"title":"123"}""")).let { (it as kotlinx.serialization.json.JsonObject)["title"] },
            )
        }

    @Test
    fun `the contract's refusals read as plain words`() {
        fun app(
            code: String,
            message: String? = null,
        ) = AppError(
            "app error",
            buildJsonObject {
                put("code", code)
                put("fields", buildJsonObject { message?.let { put("message", it) } })
            },
        )
        assertEquals("The poll has moved on to another step. Voting is closed.", VoteErrorText.describe(app("Phase", "voting is closed")))
        assertEquals("That poll isn't in this voting group.", VoteErrorText.describe(app("NotFound")))
        assertTrue(VoteErrorText.describe(app("Forbidden", "not a trustee")).startsWith("You can't do that"))
        assertEquals("Too many options.", VoteErrorText.describe(app("Invalid", "too many options")))
        assertEquals("You cancelled the passkey prompt, so nothing changed.", VoteErrorText.describe(ConfirmCancelled()))
        assertEquals("Your session ended. Sign in again.", VoteErrorText.describe(LoginRequired("expired")))
        assertTrue(VoteErrorText.describe(ReleaseDeadlineError("x", buildJsonObject { put("release", "1.2.0") })).contains("1.2.0"))
        assertTrue(VoteErrorText.describe(ConsentStale("x")).contains("already decided"))
        assertTrue(VoteErrorText.describe(WrongNode("x")).contains("can't serve"))
    }

    @Test
    fun `a ballot must verify in one call`() {
        val draft = PollDraft(ME, emptyList()).copy(title = "Q", options = (1..16).map { "Option $it" })
        assertTrue("a single choice among 16 is 33 branches", draft.fitsOneBallot)
        val multi = draft.copy(mode = PollDraft.Mode.MULTI, maxChoices = 16)
        assertFalse("16 options, up to 16 picks: 49 branches", multi.fitsOneBallot)
        assertTrue(multi.copy(maxChoices = 5).fitsOneBallot)
    }
}
