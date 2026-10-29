package network.calimero.stream.core

import kotlin.math.roundToInt

/**
 * Broadcaster slots, as the web app runs them (`app/src/lib/slots.ts`): at most two people send
 * video at once; every peer ranks the active broadcasters by when they started (floored by when
 * this peer first saw them) and yields its own camera if it falls outside the cap.
 */
object Slots {
    const val MAX_BROADCASTERS = 2
    const val CLAIM_BACKDATE_GRACE_MS = 5_000L
    const val DEGRADED_FROM_BROADCASTERS = 2
    const val DEGRADED_DELIVERY_PERCENT = 60

    fun effectiveStart(claim: Claim): Long = maxOf(claim.startedAtMs, claim.firstSeenAt - CLAIM_BACKDATE_GRACE_MS)

    private val order =
        Comparator<Claim> { a, b ->
            val sa = effectiveStart(a)
            val sb = effectiveStart(b)
            if (sa != sb) sa.compareTo(sb) else a.id.compareTo(b.id)
        }

    @Suppress("LongParameterList")
    fun evaluate(
        others: List<Claim>,
        me: String?,
        myStartedAtMs: Long?,
        nowMs: Long,
        timeoutMs: Long,
        max: Int = MAX_BROADCASTERS,
    ): SlotView {
        val claims = (if (me != null) others.filter { it.id != me } else others).toMutableList()
        if (me != null && myStartedAtMs != null) claims += Claim(me, myStartedAtMs, myStartedAtMs, nowMs)
        val ranked = claims.filter { it.lastSeenAt >= nowMs - timeoutMs }.sortedWith(order)
        val holders = ranked.take(max)
        val myRank = if (me != null && myStartedAtMs != null) ranked.indexOfFirst { it.id == me }.takeIf { it >= 0 } else null
        val broadcasting = myRank != null
        return SlotView(
            ranked = ranked,
            holders = holders,
            occupied = holders.size,
            free = maxOf(0, max - holders.size),
            full = holders.size >= max,
            myRank = myRank,
            mayClaim = !broadcasting && holders.size < max,
            mustYield = broadcasting && (myRank ?: 0) >= max,
        )
    }
}

data class Claim(
    val id: String,
    val startedAtMs: Long,
    val firstSeenAt: Long,
    val lastSeenAt: Long,
)

data class SlotView(
    val ranked: List<Claim>,
    val holders: List<Claim>,
    val occupied: Int,
    val free: Int,
    val full: Boolean,
    val myRank: Int?,
    val mayClaim: Boolean,
    val mustYield: Boolean,
) {
    companion object {
        val EMPTY = Slots.evaluate(emptyList(), null, null, 0, 0)
    }
}

/** The shared encoding budget (`app/src/lib/capacity.ts` `adaptiveEncoding`). */
data class Encoding(
    val fps: Int,
    val bitrate: Int,
) {
    companion object {
        const val MIN_FPS = 10
        const val MIN_BITRATE = 400_000

        fun adaptive(
            base: Encoding,
            broadcasters: Int,
        ): Encoding {
            val live = maxOf(1, broadcasters)
            val baseFps = maxOf(1, base.fps)
            val bitrate = maxOf(0, base.bitrate)
            return Encoding(
                fps = maxOf(minOf(MIN_FPS, baseFps), (baseFps.toDouble() / live).roundHalfUp()),
                bitrate = maxOf(minOf(MIN_BITRATE, bitrate), (bitrate.toDouble() / live).roundHalfUp()),
            )
        }

        /** JavaScript's `Math.round` (half up), which `roundToInt` matches for these positive values. */
        private fun Double.roundHalfUp(): Int = roundToInt()
    }
}
