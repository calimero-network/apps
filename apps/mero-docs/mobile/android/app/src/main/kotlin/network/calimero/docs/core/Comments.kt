package network.calimero.docs.core

import network.calimero.docs.generated.CommentDto

// Comments. The contract keeps flat, per-document comments (`add_comment`, `list_comments`): a
// body, an author and a time, with no block and no parent. The web app has no comments UI yet, so
// this app sets the convention: a comment on a block starts its body with `[[block:<id>]]`, a reply
// with `[[reply:<comment id>]]`, then a space and the text. A body without either is a comment on
// the whole document. (Swift `Comments.swift`.)

/** One comment, its body's prefix read. */
data class DocComment(
    val id: String,
    /** The author's account, 64 hex. */
    val author: String,
    /** Nanoseconds since the Unix epoch. */
    val createdAt: ULong,
    /** The words, prefix removed. */
    val text: String,
    /** The block the comment is on; null for the whole document or a reply. */
    val blockId: String? = null,
    /** The comment this answers. */
    val replyTo: String? = null,
) {
    companion object {
        fun of(dto: CommentDto): DocComment {
            val parsed = CommentBody.parse(dto.body)
            return DocComment(dto.id, dto.author, dto.createdAt, parsed.text, parsed.blockId, parsed.replyTo)
        }
    }
}

/** A comment and its replies, oldest first. */
data class CommentThread(
    val root: DocComment,
    val replies: List<DocComment>,
) {
    val id: String get() = root.id
}

object CommentBody {
    data class Parsed(
        val text: String,
        val blockId: String? = null,
        val replyTo: String? = null,
    )

    /** The body to send. */
    fun encode(
        text: String,
        blockId: String? = null,
        replyTo: String? = null,
    ): String {
        val words = text.trim()
        return when {
            replyTo != null -> "[[reply:$replyTo]] $words"
            blockId != null -> "[[block:$blockId]] $words"
            else -> words
        }
    }

    /** A body's text and what its prefix names. */
    fun parse(body: String): Parsed {
        if (!body.startsWith("[[")) return Parsed(body)
        val close = body.indexOf("]]")
        if (close < 0) return Parsed(body)
        val tag = body.substring(2, close)
        val rest = body.substring(close + 2).removePrefix(" ")
        val colon = tag.indexOf(':')
        if (colon < 0) return Parsed(body)
        val value = tag.substring(colon + 1)
        if (value.isEmpty() || value.any { it.isWhitespace() }) return Parsed(body)
        return when (tag.substring(0, colon)) {
            "block" -> Parsed(rest, blockId = value)
            "reply" -> Parsed(rest, replyTo = value)
            else -> Parsed(body)
        }
    }

    /**
     * Comments as threads: each reply under the thread its parent is in (a reply to a reply joins
     * the same thread). A reply whose parent is gone stands alone.
     */
    fun threads(comments: List<DocComment>): List<CommentThread> {
        val sorted = comments.sortedWith(compareBy<DocComment> { it.createdAt }.thenBy { it.id })
        val byId = LinkedHashMap<String, DocComment>()
        sorted.forEach { byId.putIfAbsent(it.id, it) }

        fun rootId(c: DocComment): String {
            val seen = mutableSetOf(c.id)
            return generateSequence(c) { current -> current.replyTo?.let { byId[it] }?.takeIf { seen.add(it.id) } }.last().id
        }
        val roots = mutableListOf<DocComment>()
        val replies = mutableMapOf<String, MutableList<DocComment>>()
        for (c in sorted) {
            val root = rootId(c)
            if (root == c.id) roots += c else replies.getOrPut(root) { mutableListOf() } += c
        }
        return roots.map { CommentThread(it, replies[it.id].orEmpty()) }
    }

    /** How many comments are on each block, counting replies in its threads. */
    fun countsByBlock(threads: List<CommentThread>): Map<String, Int> {
        val out = mutableMapOf<String, Int>()
        for (t in threads) {
            val block = t.root.blockId ?: continue
            out[block] = (out[block] ?: 0) + 1 + t.replies.size
        }
        return out
    }
}
