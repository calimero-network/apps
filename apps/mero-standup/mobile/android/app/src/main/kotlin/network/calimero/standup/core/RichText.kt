package network.calimero.standup.core

/**
 * The little formatting a standup needs (the web's `lib/rich.ts`): bullet lines, links and
 * `code`. Parsed into data; rendering never interprets markup, since an update is text a teammate
 * wrote.
 */
object RichText {
    sealed interface Inline {
        data class Text(
            val text: String,
        ) : Inline

        data class Code(
            val text: String,
        ) : Inline

        data class Link(
            val url: String,
        ) : Inline
    }

    sealed interface Block {
        data class Paragraph(
            val inlines: List<Inline>,
        ) : Block

        data class ListBlock(
            val items: List<List<Inline>>,
        ) : Block
    }

    /** Consecutive bullet lines become one list; everything else a paragraph. */
    fun parse(text: String): List<Block> {
        val blocks = mutableListOf<Block>()
        for (line in text.split("\n")) {
            if (line.isBlank()) continue
            val body = bulletBody(line)
            if (body != null) {
                val last = blocks.lastOrNull()
                if (last is Block.ListBlock) {
                    blocks[blocks.size - 1] = Block.ListBlock(last.items + listOf(inlines(body)))
                } else {
                    blocks += Block.ListBlock(listOf(inlines(body)))
                }
            } else {
                blocks += Block.Paragraph(inlines(line))
            }
        }
        return blocks
    }

    /** `- x`, `* x`, `• x`, `1. x`, `1) x` -> `x`; null for any other line. */
    internal fun bulletBody(line: String): String? = BULLET.find(line)?.let { line.substring(it.range.last + 1) }

    /** Text, `code` spans and http(s) links. */
    fun inlines(text: String): List<Inline> {
        val out = mutableListOf<Inline>()
        var last = 0
        for (m in TOKEN.findAll(text)) {
            if (m.range.first > last) out += Inline.Text(text.substring(last, m.range.first))
            val code = m.groups[1]
            if (code != null) out += Inline.Code(code.value.drop(1).dropLast(1)) else out += Inline.Link(m.value)
            last = m.range.last + 1
        }
        if (last < text.length) out += Inline.Text(text.substring(last))
        return out
    }

    private val BULLET = Regex("""^[ \t]*(?:[-*•]|\d+[.)])\s+""")
    private val TOKEN = Regex("""(`[^`\n]+`)|(https?://[^\s<>()]+[^\s<>().,;:!?'"])""")
}
