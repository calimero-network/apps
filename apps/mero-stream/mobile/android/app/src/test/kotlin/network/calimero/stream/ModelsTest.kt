package network.calimero.stream

import com.calimero.mero.app.AppNamespace
import com.calimero.mero.app.AppSubgroup
import com.calimero.mero.testkit.InMemoryAppBackend
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import network.calimero.stream.app.CallModel
import network.calimero.stream.app.InvitationLanding
import network.calimero.stream.app.RoomSummary
import network.calimero.stream.app.RoomsModel
import network.calimero.stream.app.StreamSummary
import network.calimero.stream.app.StreamsModel
import network.calimero.stream.core.FrameReassembler
import network.calimero.stream.core.LiveFrame
import network.calimero.stream.core.LiveFrames
import network.calimero.stream.core.MediaChannel
import network.calimero.stream.core.MediaSlice
import network.calimero.stream.core.Mulaw
import network.calimero.stream.core.StreamInvitation
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A presence channel in memory: records what is published. */
class FakeChannel(
    override val selfAuthor: String? = "me-device",
) : MediaChannel {
    val published = mutableListOf<ByteArray>()
    var retractions = 0
    private val incoming = MutableSharedFlow<MediaSlice>()

    override suspend fun publish(
        contextId: String,
        slice: ByteArray,
    ) {
        published += slice
    }

    override suspend fun retract(contextId: String) {
        retractions++
    }

    override fun slices(contextId: String): Flow<MediaSlice> = incoming
}

private fun member(
    id: String,
    name: String,
) = buildJsonObject {
    put("memberId", id)
    put("username", name)
    put("joinedAt", 1)
    put("updatedAt", 1)
}

class StreamsModelTest {
    @Test fun `loads streams with room counts`() =
        runTest {
            val backend = InMemoryAppBackend()
            backend.namespaces = listOf(AppNamespace("ns1", "Studio", backend.applicationId, 3))
            backend.subgroups = mapOf("ns1" to listOf(AppSubgroup("g1", "Daily", listOf("c1"))))
            val model = StreamsModel(backend)
            model.load()
            assertEquals(listOf(StreamSummary("ns1", "Studio", 3, 1)), model.streams.value)
            assertNull(model.error.value)
        }

    @Test fun `create founds a namespace`() =
        runTest {
            val backend = InMemoryAppBackend()
            val model = StreamsModel(backend)
            assertEquals("Launch", model.create("  Launch  ")?.name)
            assertEquals("foundNamespace Launch", backend.log.first())
            assertEquals(1, model.streams.value.size)
        }

    @Test fun `a stream invite round trips and joining lands on it`() =
        runTest {
            val backend = InMemoryAppBackend()
            val model = StreamsModel(backend)
            val link = model.inviteLink(StreamSummary("0a".repeat(32), "Studio"))!!
            assertTrue(link.startsWith("https://links.calimero.network/com.calimero.mero-stream/join?invitation="))
            val invitation = StreamInvitation.parse(link)!!
            assertEquals(StreamInvitation.Kind.NAMESPACE, invitation.kind)
            assertEquals("Studio", invitation.namespaceName)
            assertEquals(InvitationLanding.Stream(StreamSummary(invitation.namespaceId, "Studio")), model.join(invitation))
            assertTrue("joinNamespace ${invitation.namespaceId}" in backend.log)
        }
}

class RoomsModelTest {
    private val stream = StreamSummary("ns1", "Studio")

    @Test fun `creating a room makes an open subgroup and its call`() =
        runTest {
            val backend = InMemoryAppBackend()
            val model = RoomsModel(stream, backend, "app1")
            val room = model.create("Standup")!!
            assertNotNull(room.contextId)
            assertEquals(setOf(room.id), backend.publicSubgroups)
            assertEquals(JsonPrimitive("Standup"), backend.initArgs[room.contextId]!!.jsonObject["name"])
            assertEquals(listOf(room), model.rooms.value)
        }

    @Test fun `load lists rooms and enter joins the call`() =
        runTest {
            val backend = InMemoryAppBackend()
            backend.subgroups = mapOf("ns1" to listOf(AppSubgroup("g1", "Daily", listOf("c1"))))
            backend.recording.handler = { if (it.method == "get_members") JsonArray(listOf(member("x", "Xia"))) else JsonNull }
            val model = RoomsModel(stream, backend, "app1")
            model.load()
            assertEquals(listOf("Daily"), model.rooms.value.map { it.title })
            assertEquals(listOf("Xia"), model.rosters.value["c1"]?.map { it.username })
            assertEquals("c1", model.enter(model.rooms.value[0])?.contextId)
            assertTrue("joinContext c1" in backend.log)
        }

    @Test fun `a room invite carries the room and another app's link is refused`() =
        runTest {
            val model = RoomsModel(stream, InMemoryAppBackend(), "app1")
            val link = model.inviteLink(RoomSummary("g1", "ns1", "Daily", "c1"))!!
            val invitation = StreamInvitation.parse(link)!!
            assertTrue(invitation.opensRoom)
            assertEquals("g1", invitation.roomId)
            assertEquals("c1", invitation.contextId)
            assertEquals("Daily", invitation.roomName)
            assertNull(StreamInvitation.parse(link.replace("mero-stream", "mero-chat")))
        }
}

@OptIn(ExperimentalCoroutinesApi::class)
class CallModelTest {
    private val room = RoomSummary("g1", "ns1", "Daily", "c1")

    private fun TestScope.make(channel: FakeChannel = FakeChannel()): Triple<CallModel, InMemoryAppBackend, FakeChannel> {
        val backend = InMemoryAppBackend()
        backend.recording.handler = {
            when (it.method) {
                "join" -> member("me-device", "Ana")
                "get_members" -> JsonArray(listOf(member("me-device", "Ana"), member("bo", "Bo")))
                else -> JsonNull
            }
        }
        val model = CallModel(room, "c1", backend, channel, "Ana", backgroundScope, now = { 1_000_000L + testScheduler.currentTime })
        return Triple(model, backend, channel)
    }

    private fun slices(frame: LiveFrame) = LiveFrames.encodeFragments(frame)

    private fun video(
        seq: Long,
        key: Boolean,
        started: Long = 900_000,
    ) = LiveFrame(seq, 0, key, 640, 480, seq, 999_000, started, "avc1.42001f", byteArrayOf(0, 0, 0, 1, 0x65))

    @Test fun `joins the room with the name and reads the roster`() =
        runTest {
            val (model, backend, _) = make()
            model.start()
            runCurrent()
            assertTrue(model.joined.value)
            assertEquals(
                JsonPrimitive("Ana"),
                backend.recording
                    .calls("join")
                    .first()
                    .args.jsonObject["username"],
            )
            assertEquals(listOf("Ana", "Bo"), model.people().map { it.name })
            model.stop()
        }

    @Test fun `a peer is decoded from its first keyframe only`() =
        runTest {
            val (model, _, _) = make()
            val decoded = mutableListOf<Long>()
            model.onVideo = { author, frame ->
                assertEquals("bo", author)
                decoded += frame.msgSeq
            }
            for (frame in listOf(video(1, false), video(2, true), video(3, false))) {
                slices(frame).forEach { model.ingest(MediaSlice("bo", it)) }
            }
            assertEquals(listOf(2L, 3L), decoded)
            assertEquals(listOf("bo"), model.peers.value.map { it.id })
            assertTrue(model.peers.value[0].decoding)
            model.decoderFailed("bo")
            slices(video(4, false)).forEach { model.ingest(MediaSlice("bo", it)) }
            assertEquals(listOf(2L, 3L), decoded)
        }

    @Test fun `own echo, replays and foreign slices are ignored`() =
        runTest {
            val (model, _, _) = make()
            var count = 0
            model.onVideo = { _, _ -> count++ }
            for (s in slices(video(1, true))) {
                model.ingest(MediaSlice("me-device", s))
                model.ingest(MediaSlice("bo", s, ageMs = 300))
            }
            model.ingest(MediaSlice("bo", "{}".toByteArray()))
            assertEquals(0, count)
            assertTrue(model.peers.value.isEmpty())
        }

    @Test fun `silent peers are reaped and a removal drops them`() =
        runTest {
            val (model, _, _) = make()
            val gone = mutableListOf<String>()
            model.onPeerGone = { gone += it }
            slices(video(1, true)).forEach { model.ingest(MediaSlice("bo", it)) }
            slices(video(1, true)).forEach { model.ingest(MediaSlice("cy", it)) }
            model.ingest(MediaSlice("cy", null, removed = true))
            assertEquals(listOf("bo"), model.peers.value.map { it.id })
            testScheduler.advanceTimeBy(CallModel.PEER_TIMEOUT_MS + 1)
            model.tick()
            assertTrue(model.peers.value.isEmpty())
            assertEquals(listOf("cy", "bo"), gone)
        }

    @Test fun `going live publishes web-compatible frames and yields when outranked`() =
        runTest {
            val (model, _, channel) = make()
            model.start()
            runCurrent()
            assertTrue(model.goLive())
            assertTrue(model.takeKeyframeRequest())
            val unit = ByteArray(20_000) { 7 }
            model.sendVideo(unit, true, 33, 480, 640, "avc1.42c01f")
            runCurrent()
            assertEquals(2, channel.published.size)
            val reassembler = FrameReassembler()
            val fragments = channel.published.map { LiveFrames.decodeFragment(it)!! }
            assertNull(reassembler.push("x", fragments[0]))
            val frame = reassembler.push("x", fragments[1])!!
            assertArrayEquals(unit, frame.bytes)
            assertEquals(0, frame.track)
            assertEquals(480, frame.width)

            for (author in listOf("bo", "cy")) slices(video(1, true, started = 1)).forEach { model.ingest(MediaSlice(author, it)) }
            model.tick()
            assertFalse(model.isLive.value)
            assertTrue(model.yielded.value)
            assertFalse(model.canGoLive)
            model.stop()
            runCurrent()
            assertEquals(1, channel.retractions)
        }

    @Test fun `audio travels as mulaw on track one`() =
        runTest {
            val (model, _, channel) = make()
            model.start()
            runCurrent()
            model.setMic(true)
            val samples = shortArrayOf(0, 1000, -1000, 8159)
            model.sendAudio(samples, 200_000)
            runCurrent()
            val fragment = LiveFrames.decodeFragment(channel.published.single())!!
            assertEquals(1, fragment.track)
            assertEquals("ulaw", fragment.codec)
            assertArrayEquals(Mulaw.encode(samples), fragment.payload)

            var heard = ShortArray(0)
            model.onAudio = { author, pcm ->
                assertEquals("bo", author)
                heard = pcm
            }
            model.ingest(MediaSlice("bo", channel.published.single()))
            assertArrayEquals(Mulaw.decode(Mulaw.encode(samples)), heard)
            assertEquals(setOf("bo"), model.speaking.value)
            assertTrue("audio alone is not a broadcast slot", model.peers.value.isEmpty())
            model.stop()
            advanceUntilIdle()
        }

    @Test fun `falling behind drops deltas and asks for a keyframe`() =
        runTest {
            val (model, _, _) = make()
            model.start()
            runCurrent()
            model.goLive()
            model.takeKeyframeRequest()
            for (i in 0 until 10) model.sendVideo(byteArrayOf(i.toByte()), false, i.toLong(), 480, 640, "avc1.42001f")
            assertTrue(model.stats.value.framesDropped > 0)
            assertTrue(model.takeKeyframeRequest())
            model.stop()
        }
}
