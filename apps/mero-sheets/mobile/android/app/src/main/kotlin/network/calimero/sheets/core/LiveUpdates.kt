package network.calimero.sheets.core

import com.calimero.mero.app.MeroAppBackend
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlin.coroutines.cancellation.CancellationException

/**
 * Re-read a spreadsheet when it changes: on each of the app instance's events, or every few
 * seconds when the stream is not available (signed out) or ends. Runs until cancelled.
 */
object LiveUpdates {
    suspend fun follow(
        backend: MeroAppBackend,
        contextId: String,
        intervalMs: Long = MeroSheets.POLL_INTERVAL_MS,
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
