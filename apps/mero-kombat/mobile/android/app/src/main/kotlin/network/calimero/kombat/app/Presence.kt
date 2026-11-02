package network.calimero.kombat.app

import com.calimero.mero.CalimeroClient
import com.calimero.mero.CloudEvent
import com.calimero.mero.crypto.Hex
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.flatMapConcat
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.concurrent.atomic.AtomicLong

/**
 * The fight's presence channel: this fighter's slices out, the opponent's in, as JSON text the page
 * reads and writes. The native side never looks inside a slice. (Swift `PresenceChannel`.)
 */
interface PresenceChannel {
    /** Publish this fighter's slice, replacing the last one. */
    suspend fun publish(sliceJson: String)

    /** Take this fighter's slice down (leaving the arena). */
    suspend fun retract()

    /** Everyone's slices in the arena, as they arrive. */
    fun slices(): Flow<String>
}

/**
 * Presence on a Calimero 1.0 cluster: the arena app instance's presence (`POST /apps/{app}/presence`,
 * read off `/apps/{app}/presence/stream`). One entry per account and device, newest `seq` wins, at
 * most 4 KiB, gone 7 s after its last refresh. Nothing is stored. (Swift `CalimeroPresenceChannel`.)
 */
class CalimeroPresenceChannel(
    private val client: CalimeroClient,
    private val contextId: String,
) : PresenceChannel {
    private val seq = AtomicLong(0)

    override suspend fun publish(sliceJson: String) = client.publishPresence(contextId, seq.incrementAndGet(), sliceJson.encodeToByteArray())

    override suspend fun retract() {
        runCatching { client.publishPresence(contextId, seq.incrementAndGet(), null) }
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    override fun slices(): Flow<String> = client.presenceStream(contextId).flatMapConcat { slices(it).asFlow() }

    companion object {
        /**
         * The slices one stream event carries: a `snapshot` (an array of entries) or one `presence`
         * diff. Entries without state (someone left) carry no slice.
         */
        fun slices(event: CloudEvent): List<String> {
            val entries =
                when (val data = event.data) {
                    is JsonArray -> data.toList()
                    is JsonObject -> listOf(data)
                    else -> emptyList()
                }
            return entries.mapNotNull { entry ->
                val hex = ((entry as? JsonObject)?.get("state") as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
                runCatching { Hex.decodeUnsized(hex, "presence state").decodeToString() }.getOrNull()
            }
        }
    }
}

/**
 * The web app's publishing rule, natively: one slice in flight at a time, and while one is, only the
 * newest waits behind it. At 15 slices a second a slow node drops stale frames instead of queueing
 * them, so the opponent always sees where this fighter is NOW. (Swift `SlicePublisher`.)
 */
class SlicePublisher(
    private val channel: PresenceChannel,
) {
    private val lock = Mutex()
    private var inFlight = false
    private var waiting: String? = null

    /** Slices sent, for the tests. */
    var sent = 0
        private set
    var dropped = 0
        private set

    suspend fun offer(sliceJson: String) {
        val first =
            lock.withLock {
                if (inFlight) {
                    if (waiting != null) dropped += 1
                    waiting = sliceJson
                    false
                } else {
                    inFlight = true
                    true
                }
            }
        if (!first) return
        var next: String? = sliceJson
        while (next != null) {
            val slice: String = next
            lock.withLock { sent += 1 }
            try {
                channel.publish(slice)
            } catch (e: CancellationException) {
                lock.withLock { inFlight = false }
                throw e
            } catch (_: Exception) {
                // A dropped frame is replaced 66 ms later.
            }
            next =
                lock.withLock {
                    val queued = waiting
                    waiting = null
                    if (queued == null) inFlight = false
                    queued
                }
        }
    }
}
