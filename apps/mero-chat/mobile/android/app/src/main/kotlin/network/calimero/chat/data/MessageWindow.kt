package network.calimero.chat.data

/**
 * The part of a channel this device holds: a run of top-level messages, ascending by their stable
 * index (lib.rs `MessageWithReactions::index` — appends land at the end, a delete keeps its slot).
 * Pure, so the paging rules are testable on their own:
 *
 * - open and refresh read the newest page (`get_messages`, offset 0);
 * - scrolling back reads the window that ends where this one begins (`get_messages_from`,
 *   the web app's `MessageSync.loadOlder`);
 * - a refresh that lands past the newest message held reads the gap in between
 *   (`get_messages_from`, the web app's catch-up), so nothing is skipped after time away.
 */
data class MessageWindow(
    /** Ascending by index; one entry per message id. */
    val messages: List<ChatMessage> = emptyList(),
    /** How many top-level messages the channel holds, as the node last said. */
    val totalCount: Long = 0,
) {
    val oldestIndex: Long? get() = messages.firstOrNull()?.index
    val newestIndex: Long? get() = messages.lastOrNull()?.index

    /** More history exists before what is held. */
    val hasOlder: Boolean get() = (oldestIndex ?: 0L) > 0L

    /**
     * Fold [page] in: a message already held is replaced (reactions, edits and deletes change a
     * message without moving it), a new one is placed by index.
     */
    fun merge(
        page: List<ChatMessage>,
        total: Long? = null,
    ): MessageWindow {
        if (page.isEmpty()) return copy(totalCount = total ?: totalCount)
        val byId = LinkedHashMap<String, ChatMessage>()
        messages.forEach { byId[it.id] = it }
        page.forEach { byId[it.id] = it }
        val merged = byId.values.sortedWith(compareBy<ChatMessage>({ it.index }, { it.timestamp }))
        return MessageWindow(merged, maxOf(total ?: totalCount, (merged.last().index + 1)))
    }

    /** The `get_messages_from(start, limit)` that reads the [pageSize] messages before this window, or null at the start. */
    fun olderRequest(pageSize: Int = ChatArgs.PAGE_SIZE): RangeRequest? {
        val oldest = oldestIndex ?: return null
        if (oldest <= 0L) return null
        val start = maxOf(0L, oldest - pageSize)
        return RangeRequest(start, (oldest - start).toInt())
    }

    /**
     * The `get_messages_from(start, limit)` that fills the gap between this window and a fresher
     * [page] starting further on, or null when the two touch (or nothing is held yet).
     */
    fun gapBefore(page: List<ChatMessage>): RangeRequest? {
        val newest = newestIndex ?: return null
        val first = page.minOfOrNull { it.index } ?: return null
        if (first <= newest + 1) return null
        val start = newest + 1
        return RangeRequest(start, (first - start).coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
    }
}

/** Arguments for one `get_messages_from` call. */
data class RangeRequest(
    val start: Long,
    val limit: Int,
)
