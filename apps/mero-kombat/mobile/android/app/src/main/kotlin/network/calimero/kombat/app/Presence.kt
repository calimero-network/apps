package network.calimero.kombat.app

import com.calimero.mero.ephemeral.RawCodec
import com.calimero.mero.presence.RelayPresenceClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

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
 * Presence through the account's relay ([RelayPresenceClient]): each slice is a statement the device
 * key signs and the relay gossips. A phone has no node, so this is the only path.
 */
class RelayPresenceChannel(
    private val client: RelayPresenceClient,
    private val contextId: String,
) : PresenceChannel {
    override suspend fun publish(sliceJson: String) = client.set(contextId, sliceJson.encodeToByteArray(), RawCodec)

    override suspend fun retract() {
        runCatching { client.set(contextId, null, RawCodec) }
    }

    override fun slices(): Flow<String> =
        client
            .subscribe(contextId, RawCodec)
            .filter { !it.removed }
            .mapNotNull { it.state?.decodeToString() }
}

/**
 * The web app's publishing rule, natively: one slice in flight at a time, and while one is, only the
 * newest waits behind it. At 15 slices a second a slow relay drops stale frames instead of queueing
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
