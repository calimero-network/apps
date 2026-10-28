package network.calimero.issues.core

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlin.coroutines.cancellation.CancellationException

/**
 * Re-read a repo when it changes: on each of the relay's events for the context, or every few
 * seconds when the stream is not available (no relay session yet) or ends. Runs until cancelled.
 */
object LiveUpdates {
    suspend fun follow(
        backend: MeroAppBackend,
        contextId: String,
        intervalMs: Long = Tracker.POLL_INTERVAL_MS,
        reload: suspend () -> Unit,
    ) {
        if (backend.canSubscribe) {
            try {
                backend.events(contextId).collect { reload() }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // The stream broke: fall back to polling.
            }
        }
        while (currentCoroutineContext().isActive) {
            delay(intervalMs)
            reload()
        }
    }
}
