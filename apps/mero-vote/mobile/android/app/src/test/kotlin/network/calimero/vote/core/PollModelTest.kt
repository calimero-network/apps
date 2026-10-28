package network.calimero.vote.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import network.calimero.vote.crypto.RistrettoPoint
import network.calimero.vote.crypto.Scalar
import network.calimero.vote.crypto.VoteProtocol
import network.calimero.vote.generated.Ceremony
import network.calimero.vote.generated.CeremonyTrustee
import network.calimero.vote.generated.Identity
import network.calimero.vote.generated.Phase
import network.calimero.vote.generated.PollView
import network.calimero.vote.generated.TallyInputs
import network.calimero.vote.generated.Transcript
import network.calimero.vote.generated.TrusteeStatus
import network.calimero.vote.generated.WireBallot
import network.calimero.vote.generated.WireBranch
import network.calimero.vote.generated.WireCiphertext
import network.calimero.vote.generated.WirePartial
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** PollModel against the scripted contract, with the web's vectors as the poll. */
class PollModelTest {
    private val transcript: Transcript = Vectors.transcript()
    private val pollId = Vectors.pollId
    private val trustees = Vectors.trustees
    private val transport = Vectors.root["transport"]!!.jsonArray.map { it.jsonObject }

    private fun view(
        phase: Phase,
        withElection: Boolean = true,
    ): PollView {
        val state =
            when (phase) {
                Phase.Closed -> transcript.state
                Phase.KeyCeremony -> transcript.state.copy(phase = phase, election = null, closure = null)
                else -> transcript.state.copy(phase = phase, closure = null, election = transcript.state.election.takeIf { withElection })
            }
        return PollView(
            pollId = pollId,
            definition = transcript.definition,
            state = state,
            trustees =
                trustees.mapIndexed { i, t ->
                    TrusteeStatus(t, (i + 1).toUInt(), phase != Phase.KeyCeremony, phase != Phase.KeyCeremony, 0u, null, false)
                },
            turnout = emptyList(),
            myDigest = null,
            canVote = true,
        )
    }

    private fun model(
        backend: com.calimero.mero.testkit.InMemoryAppBackend,
        keys: TrusteeKeyStore = MemoryTrusteeKeyStore(),
        seed: String = "poll-model",
    ) = PollModel(backend, group(), pollId, keys, VoteProtocol.seededRng(seed), Dispatchers.Unconfined)

    @Test
    fun `a cast ballot verifies under the election key as the voter's own`() =
        runTest {
            val (backend, script) = makeBackend(ME)
            script.on("whoami") { Identity(ME) }
            script.on("get_poll") { view(Phase.Voting) }
            script.on("cast_ballot") { "digest" }
            val model = model(backend)
            model.load()
            model.toggle(0)
            model.toggle(1)
            model.toggle(2)
            assertFalse("three picks on an up-to-two poll", model.canCast)
            model.toggle(1)
            assertTrue(model.canCast)
            model.cast()
            assertNull(model.error.value)
            val call = backend.recording.calls("cast_ballot").single()
            assertEquals(pollId, call.string("poll_id"))
            val wire = testJson.decodeFromJsonElement(WireBallot.serializer(), call.arg("ballot")!!)
            val pk = RistrettoPoint.fromHex(transcript.state.election!!.key)
            val rules = VoteWire.rules(transcript.definition)
            VoteProtocol.verifyBallot(pk, pollId, ME, rules, VoteWire.ballot(wire))
            try {
                VoteProtocol.verifyBallot(pk, pollId, BOB, rules, VoteWire.ballot(wire))
                fail("someone else's ballot must not verify")
            } catch (_: IllegalArgumentException) {
            }
            assertEquals(listOf(false, false, false), model.selection.value)
            assertNotNull(model.note.value)
        }

    @Test
    fun `a pick-one poll keeps one selection`() =
        runTest {
            val (backend, script) = makeBackend(ME)
            script.on("whoami") { Identity(ME) }
            script.on("get_poll") { view(Phase.Voting).let { it.copy(definition = it.definition.copy(minChoices = 1u, maxChoices = 1u)) } }
            val model = model(backend)
            model.load()
            model.toggle(0)
            model.toggle(1)
            assertEquals(listOf(false, true, false), model.selection.value)
        }

    @Test
    fun `publishing a transport key keeps the secret here and sends its public key`() =
        runTest {
            val me = trustees[0]
            val (backend, script) = makeBackend(me)
            script.on("whoami") { Identity(me) }
            script.on("get_poll") { view(Phase.KeyCeremony) }
            script.on("ceremony") { Ceremony(2u, trustees.mapIndexed { i, t -> CeremonyTrustee(t, (i + 1).toUInt()) }, emptyList()) }
            val keys = MemoryTrusteeKeyStore()
            val model = model(backend, keys)
            model.load()
            assertTrue(model.amTrustee)
            model.publishTransportKey()
            val stored = keys.load(CTX, pollId, me)
            assertNotNull(stored)
            val call = backend.recording.calls("publish_transport_key").single()
            val key = call.string("key")!!
            assertEquals(RistrettoPoint.BASE.multiply(Scalar.fromHex(stored!!.secret)).hex(), key)
            val proof = testJson.decodeFromJsonElement(WireBranch.serializer(), call.arg("proof")!!)
            assertTrue(VoteProtocol.verifyTransportKey(pollId, me, RistrettoPoint.fromHex(key), VoteWire.branch(proof)))
        }

    @Test
    fun `a device that cannot store the key does not publish`() =
        runTest {
            val me = trustees[0]
            val (backend, script) = makeBackend(me)
            script.on("whoami") { Identity(me) }
            script.on("get_poll") { view(Phase.KeyCeremony) }
            val keys = MemoryTrusteeKeyStore().apply { refuses = true }
            val model = model(backend, keys)
            model.load()
            model.publishTransportKey()
            assertEquals("This device can't store your trustee key.", model.error.value)
            assertTrue(backend.recording.calls("publish_transport_key").isEmpty())
        }

    @Test
    fun `restore refuses a key that does not match the published one`() =
        runTest {
            val me = trustees[0]
            val (backend, script) = makeBackend(me)
            script.on("whoami") { Identity(me) }
            script.on("get_poll") { view(Phase.Voting) }
            val model = model(backend)
            model.load()
            val wrong = TrusteeKey(contextId = CTX, pollId = pollId, account = me, secret = transport[1]["secret"]!!.jsonPrimitive.content)
            try {
                model.restoreKey(wrong.json())
                fail("a mismatched key is refused")
            } catch (e: VoteModelException) {
                assertEquals("This key does not match the transport key you published.", e.message)
            }
            try {
                model.restoreKey(wrong.copy(pollId = "other").json())
                fail("another poll's key is refused")
            } catch (e: VoteModelException) {
                assertEquals("This key is for a different poll.", e.message)
            }
            val right = wrong.copy(secret = transport[0]["secret"]!!.jsonPrimitive.content)
            model.restoreKey(right.json())
            assertEquals(right, model.trusteeKey.value)
        }

    @Test
    fun `a decryption share is proven against the trustee's verification key`() =
        runTest {
            val me = trustees[0]
            val (backend, script) = makeBackend(me)
            script.on("whoami") { Identity(me) }
            script.on("get_poll") { view(Phase.Closed) }
            script.put("get_result") {
                testJson.encodeToJsonElement(
                    network.calimero.vote.generated.AuditReport
                        .serializer(),
                    transcript.report,
                )
            }
            val aggregate = Vectors.root["aggregate"]!!.jsonArray.map { WireCiphertext(it.jsonObject["a"]!!.jsonPrimitive.content, it.jsonObject["b"]!!.jsonPrimitive.content) }
            script.on("tally_inputs") { TallyInputs(aggregate, 5u) }
            val keys = MemoryTrusteeKeyStore()
            keys.save(TrusteeKey(contextId = CTX, pollId = pollId, account = me, secret = transport[0]["secret"]!!.jsonPrimitive.content))
            val model = model(backend, keys)
            model.load()
            model.publishPartial { it }
            assertNull(model.error.value)
            val partials =
                backend.recording.calls("publish_partial").single().arg("partials")!!.jsonArray.map {
                    testJson.decodeFromJsonElement(WirePartial.serializer(), it)
                }
            val vkey =
                RistrettoPoint.fromHex(
                    Vectors.root["verification_keys"]!!
                        .jsonArray[0]
                        .jsonPrimitive.content,
                )
            assertEquals(3, partials.size)
            partials.forEachIndexed { j, p ->
                assertTrue(
                    VoteProtocol.verifyPartial(
                        pollId, me, j, vkey, RistrettoPoint.fromHex(aggregate[j].a), RistrettoPoint.fromHex(p.d), VoteWire.branch(p.proof),
                    ),
                )
            }
        }

    @Test
    fun `re-verifying the honest transcript agrees with the node`() =
        runTest {
            val (backend, script) = makeBackend(ME)
            script.put("get_transcript") { Vectors.audit("honest")["transcript"]!! }
            val model = model(backend)
            model.reverify()
            val audit = model.localAudit.value!!
            assertTrue(audit.verified)
            assertTrue(audit.agreesWithNode)
            assertEquals(Vectors.str("transcript_digest"), audit.digest)
            assertNull(model.busy.value)
        }

    @Test
    fun `the creator's status line follows the ceremony`() =
        runTest {
            val (backend, script) = makeBackend(trustees[0])
            script.on("whoami") { Identity(trustees[0]) }
            script.on("get_poll") { view(Phase.KeyCeremony) }
            val model = model(backend)
            model.load()
            assertTrue(model.isCreator)
            assertEquals("Waiting for every trustee's transport key.", model.ceremonyStatus)
            assertFalse(model.canOpenVoting)
        }
}
