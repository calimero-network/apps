package network.calimero.stream.app

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import network.calimero.stream.core.Claim
import network.calimero.stream.core.Encoding
import network.calimero.stream.core.ErrorText
import network.calimero.stream.core.FrameReassembler
import network.calimero.stream.core.LiveFrame
import network.calimero.stream.core.LiveFrames
import network.calimero.stream.core.MediaChannel
import network.calimero.stream.core.MediaSlice
import network.calimero.stream.core.Mulaw
import network.calimero.stream.core.People
import network.calimero.stream.core.Person
import network.calimero.stream.core.SlotView
import network.calimero.stream.core.Slots
import network.calimero.stream.core.StreamException
import network.calimero.stream.core.streamClient
import network.calimero.stream.generated.Member

/** A remote sender of video, as the call sees it. */
data class RemotePeer(
    val id: String,
    val startedAtMs: Long,
    val width: Int,
    val height: Int,
    /** A keyframe has arrived, so its frames reach the decoder. */
    val decoding: Boolean,
    val framesDecoded: Int,
)

/** Numbers for the call's Details sheet (the web's "Call details"). */
data class CallStats(
    val framesSent: Int = 0,
    val framesDropped: Int = 0,
    val publishErrors: Int = 0,
    val framesReceived: Int = 0,
    val audioPacketsSent: Int = 0,
    val audioPacketsReceived: Int = 0,
    /** Smoothed publish round trip, one slice. */
    val publishMs: Double? = null,
    /** Smoothed sender-to-here latency (sender's clock, so skew included). */
    val latencyMs: Double? = null,
    val lastCodec: String? = null,
)

/**
 * One call: joining the room's contract, the roster, and the media loop on the context's ephemeral
 * presence, exactly as the web's `useLiveStream` (and identical to the iOS `CallModel`):
 *
 * - **Send.** The platform encoder hands over H.264 Annex-B access units; each is framed
 *   ([LiveFrames]) into ≤16 KiB slices and published one at a time. Audio (µ-law, track 1) rides the
 *   same channel.
 * - **Receive.** Every slice is parsed and reassembled per sender and track; video passes a
 *   per-sender keyframe gate before it reaches that sender's decoder.
 * - **Slots.** At most [Slots.MAX_BROADCASTERS] send video; everyone ranks the same headers and a
 *   sender outside the cap yields.
 *
 * Every state change happens on [scope]'s dispatcher (the main thread in the app).
 */
@Suppress("TooManyFunctions")
class CallModel(
    val room: RoomSummary,
    val contextId: String,
    val backend: MeroAppBackend,
    val channel: MediaChannel?,
    name: String,
    private val scope: CoroutineScope,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val _joined = MutableStateFlow(false)
    val joined: StateFlow<Boolean> = _joined.asStateFlow()
    private val _joinFailed = MutableStateFlow<String?>(null)
    val joinFailed: StateFlow<String?> = _joinFailed.asStateFlow()
    private val _members = MutableStateFlow<List<Member>>(emptyList())
    val members: StateFlow<List<Member>> = _members.asStateFlow()
    private val _peers = MutableStateFlow<List<RemotePeer>>(emptyList())
    val peers: StateFlow<List<RemotePeer>> = _peers.asStateFlow()
    private val _speaking = MutableStateFlow<Set<String>>(emptySet())
    val speaking: StateFlow<Set<String>> = _speaking.asStateFlow()
    private val _slots = MutableStateFlow(SlotView.EMPTY)
    val slots: StateFlow<SlotView> = _slots.asStateFlow()
    private val _isLive = MutableStateFlow(false)
    val isLive: StateFlow<Boolean> = _isLive.asStateFlow()
    private val _micOn = MutableStateFlow(false)
    val micOn: StateFlow<Boolean> = _micOn.asStateFlow()
    private val _yielded = MutableStateFlow(false)
    val yielded: StateFlow<Boolean> = _yielded.asStateFlow()
    private val _name = MutableStateFlow(name)
    val name: StateFlow<String> = _name.asStateFlow()
    private val _stats = MutableStateFlow(CallStats())
    val stats: StateFlow<CallStats> = _stats.asStateFlow()
    val error = MutableStateFlow<String?>(null)

    /** This device's id in the room: the author its slices carry. */
    val me: String = channel?.selfAuthor ?: backend.account
    val startedAt: Long = now()

    /** A decodable video frame for a sender's decoder. */
    var onVideo: ((String, LiveFrame) -> Unit)? = null

    /** Decoded audio (8 kHz mono) from a sender. */
    var onAudio: ((String, ShortArray) -> Unit)? = null

    /** A sender went quiet or away: drop its decoder and player (made again on its next frame). */
    var onPeerGone: ((String) -> Unit)? = null

    private val client = streamClient(backend, contextId)

    private class PeerState(
        var startedAtMs: Long,
        val firstSeenAt: Long,
        var lastSeenAt: Long,
        var width: Int,
        var height: Int,
        var started: Boolean,
        var framesDecoded: Int,
    )

    private class Outgoing(
        val fragments: List<ByteArray>,
        val isVideo: Boolean,
    )

    private val peerStates = HashMap<String, PeerState>()
    private val audioSeen = HashMap<String, Long>()
    private val reassembler = FrameReassembler()
    private var startedAtMs: Long? = null
    private var videoSeq = 0L
    private var audioSeq = 0L
    private var lastKeyframeAt = 0L
    private var keyframeWanted = false
    private val outbox = ArrayDeque<Outgoing>()
    private var pumping = false
    private var consecutiveFailures = 0
    private val jobs = mutableListOf<Job>()
    private var joinJob: Job? = null

    // MARK: Derived

    /** What the encoder should run at: the base split among the live broadcasters. */
    val encoding: Encoding get() = Encoding.adaptive(BASE_ENCODING, maxOf(1, _slots.value.occupied))

    /** Whether "Turn on camera" may claim a slot now. */
    val canGoLive: Boolean get() = _joined.value && channel != null && (_isLive.value || _slots.value.mayClaim)

    /** The display name, or the placeholder the web uses. */
    val displayName: String get() = _name.value.trim().ifEmpty { "guest" }

    /** Everyone in the room: the contract's members plus anyone sending. */
    fun people(): List<Person> =
        People.roster(
            members = _members.value.map { it.memberId to it.username },
            liveIds = _peers.value.map { it.id }.toSet(),
            me = me,
            selfName = displayName,
            selfLive = _isLive.value,
        )

    val degraded: Boolean get() = _slots.value.occupied >= Slots.DEGRADED_FROM_BROADCASTERS

    // MARK: Lifecycle

    /** Join the room and start the media loop. */
    fun start() {
        if (jobs.isNotEmpty()) return
        joinJob = scope.launch { joinLoop() }
        jobs += scope.launch { tickLoop() }
        jobs += scope.launch { membersLoop() }
        jobs += scope.launch { eventsLoop() }
        val channel = channel
        if (channel != null) {
            jobs +=
                scope.launch {
                    try {
                        channel.slices(contextId).collect { ingest(it) }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        error.value = ErrorText.describe(e)
                    }
                }
        } else {
            error.value = StreamException.noPresence().message
        }
    }

    /** Leave: stop sending, retract our slice, stop listening. */
    fun stop() {
        jobs.forEach { it.cancel() }
        jobs.clear()
        joinJob?.cancel()
        _isLive.value = false
        _micOn.value = false
        startedAtMs = null
        outbox.clear()
        val channel = channel ?: return
        scope.launch { withContext(NonCancellable) { channel.retract(contextId) } }
    }

    // MARK: Joining and the roster

    private suspend fun joinLoop() {
        val name = displayName
        val start = now()
        var attempt = 0
        while (true) {
            try {
                client.join(name, (now() / 1000).toULong())
                _joined.value = true
                _joinFailed.value = null
                refreshMembers()
                return
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val wait = JOIN_RETRY_DELAYS_MS[minOf(attempt, JOIN_RETRY_DELAYS_MS.size - 1)]
                attempt++
                if (now() - start + wait > JOIN_DEADLINE_MS) {
                    _joinFailed.value = ErrorText.describe(e)
                    return
                }
                delay(wait)
            }
        }
    }

    /** Change your name in this room: re-join with it (the contract's join is idempotent). */
    suspend fun rename(next: String) {
        val trimmed = next.trim()
        if (trimmed.isEmpty()) return
        _name.value = trimmed
        try {
            client.join(trimmed, (now() / 1000).toULong())
            _joined.value = true
            refreshMembers()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error.value = ErrorText.describe(e)
        }
    }

    /** Try joining again after it gave up. */
    fun retryJoin() {
        _joinFailed.value = null
        joinJob = scope.launch { joinLoop() }
    }

    suspend fun refreshMembers() {
        runCatching { client.getMembers() }.getOrNull()?.let { _members.value = it }
    }

    private suspend fun membersLoop() {
        while (true) {
            delay(MEMBERS_REFRESH_MS)
            if (_joined.value) refreshMembers()
        }
    }

    /** A state change in the room (someone joined or renamed): re-read the roster. */
    private suspend fun eventsLoop() {
        if (!backend.canSubscribe) return
        try {
            backend.events(contextId).collect { event -> if (event.kind != "Ephemeral" && _joined.value) refreshMembers() }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // The members loop keeps the roster fresh without events.
        }
    }

    // MARK: Camera and mic

    /** Claim a broadcast slot. False when all slots are taken. */
    fun goLive(): Boolean {
        if (!canGoLive) return false
        if (_isLive.value) return true
        startedAtMs = now()
        _isLive.value = true
        _yielded.value = false
        keyframeWanted = true
        recomputeSlots()
        return true
    }

    fun stopLive() {
        _isLive.value = false
        startedAtMs = null
        outbox.removeAll { it.isVideo }
        recomputeSlots()
    }

    fun setMic(on: Boolean) {
        _micOn.value = on && _joined.value && channel != null
    }

    fun clearYielded() {
        _yielded.value = false
    }

    /**
     * Whether the encoder should make the next frame a keyframe: every [KEYFRAME_INTERVAL_MS] (a
     * joiner's way in), or after a dropped frame.
     */
    fun takeKeyframeRequest(): Boolean {
        val t = now()
        if (keyframeWanted || t - lastKeyframeAt >= KEYFRAME_INTERVAL_MS) {
            keyframeWanted = false
            lastKeyframeAt = t
            return true
        }
        return false
    }

    // MARK: Send

    /** Publish one encoded video access unit (Annex-B). */
    @Suppress("LongParameterList")
    fun sendVideo(
        accessUnit: ByteArray,
        isKeyframe: Boolean,
        timestampUs: Long,
        width: Int,
        height: Int,
        codec: String,
    ) {
        val started = startedAtMs
        if (!_isLive.value || started == null) return
        if (!isKeyframe && outbox.count { it.isVideo } >= MAX_QUEUED_FRAMES) {
            // Behind: dropping a delta breaks the picture until the next keyframe, so ask for one now.
            _stats.value = _stats.value.copy(framesDropped = _stats.value.framesDropped + 1)
            keyframeWanted = true
            return
        }
        videoSeq = LiveFrames.nextMsgSeq(videoSeq)
        val frame = LiveFrame(videoSeq, 0, isKeyframe, width, height, timestampUs, now(), started, codec, accessUnit)
        val fragments = runCatching { LiveFrames.encodeFragments(frame) }.getOrNull()
        if (fragments == null) {
            _stats.value = _stats.value.copy(framesDropped = _stats.value.framesDropped + 1)
            return
        }
        _stats.value = _stats.value.copy(lastCodec = codec)
        enqueue(Outgoing(fragments, isVideo = true))
    }

    /** Publish 16-bit mono samples at 8 kHz as one µ-law packet on track 1. */
    fun sendAudio(
        samples: ShortArray,
        timestampUs: Long,
    ) {
        if (!_micOn.value || !_joined.value || samples.isEmpty()) return
        audioSeq = LiveFrames.nextMsgSeq(audioSeq)
        val frame = LiveFrame(audioSeq, 1, true, 0, 0, timestampUs, now(), startedAtMs ?: 0, Mulaw.CODEC, Mulaw.encode(samples))
        val fragments = runCatching { LiveFrames.encodeFragments(frame) }.getOrNull() ?: return
        // Audio is late or it is useless: never more than one packet waiting.
        outbox.removeAll { !it.isVideo }
        enqueue(Outgoing(fragments, isVideo = false))
        _stats.value = _stats.value.copy(audioPacketsSent = _stats.value.audioPacketsSent + 1)
    }

    private fun enqueue(next: Outgoing) {
        outbox.addLast(next)
        val channel = channel ?: return
        if (pumping) return
        pumping = true
        scope.launch { pump(channel) }
    }

    /**
     * One slice at a time, in order: the relay drops a slice whose seq is below one it has already
     * applied, so concurrent publishes would race.
     */
    @Suppress("NestedBlockDepth")
    private suspend fun pump(channel: MediaChannel) {
        try {
            while (outbox.isNotEmpty()) {
                val next = outbox.removeFirst()
                var ok = true
                for (fragment in next.fragments) {
                    val began = now()
                    try {
                        channel.publish(contextId, fragment)
                        val took = (now() - began).toDouble()
                        _stats.value = _stats.value.copy(publishMs = _stats.value.publishMs?.let { it * 0.8 + took * 0.2 } ?: took)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        ok = false
                        _stats.value = _stats.value.copy(publishErrors = _stats.value.publishErrors + 1)
                        consecutiveFailures++
                        if (consecutiveFailures >= FAILURES_BEFORE_ERROR) error.value = ErrorText.describe(e)
                        break
                    }
                }
                if (ok) {
                    consecutiveFailures = 0
                    if (next.isVideo) _stats.value = _stats.value.copy(framesSent = _stats.value.framesSent + 1)
                } else if (next.isVideo) {
                    keyframeWanted = true
                }
            }
        } finally {
            pumping = false
        }
    }

    // MARK: Receive

    /** One presence slice from the room. */
    @Suppress("ReturnCount")
    fun ingest(slice: MediaSlice) {
        if (slice.removed) {
            forget(slice.author)
            return
        }
        // A replayed entry is a stale frame by definition: never decode it.
        if (slice.ageMs != null) return
        val bytes = slice.bytes ?: return
        val fragment = LiveFrames.decodeFragment(bytes) ?: return
        if (slice.author == me) return
        val t = now()
        when (fragment.track) {
            0 -> reassembler.push("${slice.author}#0", fragment)?.let { receiveVideo(slice.author, it, t) }
            1 -> {
                val frame = reassembler.push("${slice.author}#1", fragment) ?: return
                if (frame.codec != Mulaw.CODEC) return
                _stats.value = _stats.value.copy(audioPacketsReceived = _stats.value.audioPacketsReceived + 1)
                if (slice.author !in _speaking.value) _speaking.value = _speaking.value + slice.author
                audioSeen[slice.author] = t
                onAudio?.invoke(slice.author, Mulaw.decode(frame.bytes))
            }
        }
    }

    private fun receiveVideo(
        author: String,
        frame: LiveFrame,
        t: Long,
    ) {
        val existing = peerStates[author]
        val peer = existing ?: PeerState(frame.startedAtMs, t, t, frame.width, frame.height, false, 0)
        peer.lastSeenAt = t
        peer.startedAtMs = frame.startedAtMs
        peer.width = frame.width
        peer.height = frame.height
        var stats = _stats.value.copy(framesReceived = _stats.value.framesReceived + 1)
        if (frame.createdAtMs in 1..t) {
            val latency = (t - frame.createdAtMs).toDouble()
            stats = stats.copy(latencyMs = stats.latencyMs?.let { it * 0.9 + latency * 0.1 } ?: latency)
        }
        _stats.value = stats
        // Each sender is its own H.264 stream: a delta decodes only against a keyframe from the same
        // sender, and a joiner starts mid-GOP.
        val wasStarted = peer.started
        if (!peer.started && frame.isKeyframe) peer.started = true
        if (peer.started) peer.framesDecoded++
        peerStates[author] = peer
        if (existing == null) {
            publishPeers()
            recomputeSlots()
        } else if (!wasStarted && peer.started) {
            publishPeers()
        }
        if (peer.started) onVideo?.invoke(author, frame)
    }

    /** The platform decoder failed on a sender's stream: wait for its next keyframe. */
    fun decoderFailed(author: String) {
        val peer = peerStates[author] ?: return
        peer.started = false
        publishPeers()
    }

    private fun forget(author: String) {
        reassembler.forget("$author#0")
        reassembler.forget("$author#1")
        audioSeen.remove(author)
        _speaking.value = _speaking.value - author
        if (peerStates.remove(author) != null) {
            publishPeers()
            recomputeSlots()
        }
        onPeerGone?.invoke(author)
    }

    // MARK: The 1 s tick

    private suspend fun tickLoop() {
        while (true) {
            delay(TICK_MS)
            tick()
        }
    }

    /** Reap silent senders, refresh the slots, and yield when outranked. */
    fun tick() {
        val t = now()
        val cutoff = t - PEER_TIMEOUT_MS
        for (author in peerStates.filterValues { it.lastSeenAt < cutoff }.keys) {
            peerStates.remove(author)
            reassembler.forget("$author#0")
            onPeerGone?.invoke(author)
        }
        for ((author, at) in audioSeen.toMap()) {
            if (t - at > AUDIO_ACTIVE_MS) _speaking.value = _speaking.value - author
            if (t - at > PEER_TIMEOUT_MS) {
                audioSeen.remove(author)
                reassembler.forget("$author#1")
                onPeerGone?.invoke(author)
            }
        }
        publishPeers()
        if (recomputeSlots().mustYield) {
            stopLive()
            _yielded.value = true
        }
    }

    private fun publishPeers() {
        _peers.value =
            peerStates
                .map { (id, p) -> RemotePeer(id, p.startedAtMs, p.width, p.height, p.started, p.framesDecoded) }
                .sortedBy { it.id }
    }

    private fun recomputeSlots(): SlotView {
        val claims = peerStates.map { (id, p) -> Claim(id, p.startedAtMs, p.firstSeenAt, p.lastSeenAt) }
        val view = Slots.evaluate(claims, me, startedAtMs, now(), PEER_TIMEOUT_MS)
        _slots.value = view
        return view
    }

    companion object {
        const val PEER_TIMEOUT_MS = 6_000L
        const val KEYFRAME_INTERVAL_MS = 2_000L

        /**
         * A phone publishes each slice as a signed relay POST, so it starts lower than the web's
         * 25 fps / 1.5 Mbps; the shared split applies on top.
         */
        val BASE_ENCODING = Encoding(fps = 15, bitrate = 1_000_000)
        val JOIN_RETRY_DELAYS_MS = longArrayOf(500, 1_000, 2_000, 3_000, 5_000)
        const val JOIN_DEADLINE_MS = 120_000L
        const val MEMBERS_REFRESH_MS = 10_000L

        /** Someone is "speaking" while their audio arrived this recently. */
        const val AUDIO_ACTIVE_MS = 1_200L

        /** Frames waiting to be published before a new delta frame is dropped. */
        const val MAX_QUEUED_FRAMES = 3
        const val FAILURES_BEFORE_ERROR = 3
        const val TICK_MS = 1_000L
    }
}
