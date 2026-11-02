package network.calimero.stream.core

import com.calimero.mero.CalimeroClient
import com.calimero.mero.CloudEvent
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.flatMapConcat
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.concurrent.atomic.AtomicLong

/** One presence slice as it arrives. */
class MediaSlice(
    val author: String,
    val bytes: ByteArray?,
    val removed: Boolean = false,
    /** Set on a replayed entry (the seed a new subscriber gets). Stale media. */
    val ageMs: Long? = null,
)

/**
 * Where the call's media travels: the room's ephemeral presence. On Calimero 1.0 that is the app
 * instance's presence on its cluster ([CalimeroMediaChannel]): each slice is a
 * `POST /apps/{app}/presence` (at most [LiveFrames.MAX_SLICE_BYTES]), passed to every node and read
 * back off `GET /apps/{app}/presence/stream`. Nothing is stored. Tests pass a fake.
 */
interface MediaChannel {
    /** The author this session's slices carry (the account), to skip our own echo. */
    val selfAuthor: String?

    /** Publish one slice. The call publishes one at a time. */
    suspend fun publish(
        contextId: String,
        slice: ByteArray,
    )

    /** Retract our slice, on leaving. */
    suspend fun retract(contextId: String)

    /** Every slice in the context as it arrives. */
    fun slices(contextId: String): Flow<MediaSlice>
}

/**
 * [MediaChannel] over a Calimero 1.0 app instance's presence ([CalimeroClient.publishPresence] /
 * [CalimeroClient.presenceStream]). One entry per account and device: newest `seq` wins, an entry
 * not refreshed within 7 s is dropped, and state is at most 4 KiB, which [LiveFrames] fragments to.
 * (Identical to the iOS `CalimeroMediaChannel`.)
 */
class CalimeroMediaChannel(
    private val client: CalimeroClient,
    /** The signed-in account. Every device of it is skipped as our own echo. */
    override val selfAuthor: String?,
    private val clockMicros: () -> Long = { System.currentTimeMillis() * 1000 },
) : MediaChannel {
    private val seq = AtomicLong(0)

    /**
     * A `seq` that only grows, across launches too: the node keeps the highest seq it saw from this
     * device for the entry's 7 s life and drops anything at or below it, so it is seeded from the
     * clock (microseconds), as the web does.
     */
    internal fun nextSeq(): Long = seq.updateAndGet { maxOf(it + 1, clockMicros()) }

    override suspend fun publish(
        contextId: String,
        slice: ByteArray,
    ) = client.publishPresence(contextId, nextSeq(), slice)

    override suspend fun retract(contextId: String) {
        runCatching { client.publishPresence(contextId, nextSeq(), null) }
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    override fun slices(contextId: String): Flow<MediaSlice> = client.presenceStream(contextId).flatMapConcat { slices(it).asFlow() }

    companion object {
        /**
         * The slices one stream event carries: a `snapshot` (every entry present now, replayed so
         * marked stale with `ageMs`) or one `presence` diff (`state: null` when someone left). The
         * author is the account.
         */
        fun slices(event: CloudEvent): List<MediaSlice> {
            val replayed = event.kind == "snapshot"
            val entries: List<JsonElement> =
                when (val data = event.data) {
                    is JsonArray -> data
                    is JsonObject -> listOf(data)
                    else -> return emptyList()
                }
            return entries.mapNotNull { entry ->
                val o = entry as? JsonObject ?: return@mapNotNull null
                val account = (o["account"] as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
                val state = (o["state"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                if (state == null) return@mapNotNull MediaSlice(account, null, removed = true)
                val bytes = hex(state) ?: return@mapNotNull null
                MediaSlice(account, bytes, ageMs = if (replayed) 0 else null)
            }
        }

        private fun hex(text: String): ByteArray? {
            if (text.length % 2 != 0) return null
            return runCatching { ByteArray(text.length / 2) { i -> text.substring(2 * i, 2 * i + 2).toInt(16).toByte() } }.getOrNull()
        }
    }
}
