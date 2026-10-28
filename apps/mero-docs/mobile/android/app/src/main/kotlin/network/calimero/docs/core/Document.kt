package network.calimero.docs.core

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

// The read path of the web editor, ported. The contract keeps a document as a flat list of
// blocks (kind, depth, string attrs) whose text is runs of equally formatted characters;
// `get_document` hands that list back already merged, so no CRDT runs on the phone. The web turns
// the same rows into BlockNote blocks (`lib/rich/blocknote.ts`); this turns them into blocks a
// native view draws. (Swift `Document.swift`.)

/** One row of `get_document`, decoded leniently (see [DocsApi.readDocument]). */
data class WireBlock(
    val id: String,
    val kind: String,
    val depth: Int = 0,
    val attrs: Map<String, String> = emptyMap(),
    val spans: List<WireSpan> = emptyList(),
) {
    companion object {
        fun from(element: JsonElement): WireBlock {
            val o = element.jsonObject
            return WireBlock(
                id = o.string("id"),
                kind = o.string("kind"),
                depth = (o["depth"] as? JsonPrimitive)?.intOrNull ?: 0,
                attrs = lenientStrings(o["attrs"]),
                spans =
                    (o["spans"]?.takeIf { it !is JsonNull }?.jsonArray ?: emptyList()).map {
                        WireSpan(it.jsonObject.string("text"), lenientStrings(it.jsonObject["attributes"]))
                    },
            )
        }

        private fun JsonObject.string(key: String): String = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ""

        /** Strings, booleans or numbers, as strings; `false`, `null` and `""` mean not set. */
        private fun lenientStrings(element: JsonElement?): Map<String, String> {
            val o = element as? JsonObject ?: return emptyMap()
            val out = linkedMapOf<String, String>()
            for ((key, value) in o) {
                val p = value as? JsonPrimitive ?: continue
                when {
                    p is JsonNull -> Unit
                    p.isString -> if (p.content.isNotEmpty()) out[key] = p.content
                    p.booleanOrNull != null -> if (p.booleanOrNull == true) out[key] = "true"
                    p.doubleOrNull != null -> out[key] = p.content
                }
            }
            return out
        }
    }
}

/** A run of text and its marks; `attributes` is absent on a plain run, booleans arrive as `true`. */
data class WireSpan(
    val text: String,
    val attributes: Map<String, String> = emptyMap(),
)

/** A run of text drawn with one set of marks. (Swift `InlineRun`.) */
data class InlineRun(
    val text: String,
    val bold: Boolean = false,
    val italic: Boolean = false,
    val underline: Boolean = false,
    val strike: Boolean = false,
    val code: Boolean = false,
    /** The href of the link the run sits in. */
    val link: String? = null,
    /** A BlockNote colour name (`red`, `blue`, …). */
    val textColor: String? = null,
    val backgroundColor: String? = null,
) {
    fun sameMarks(o: InlineRun) = copy(text = "") == o.copy(text = "")

    companion object {
        /** The run a span is, by the web's mark keys (`lib/rich/attributes.ts`). */
        fun of(span: WireSpan): InlineRun {
            val a = span.attributes

            fun on(key: String) = a[key]?.let { it != "false" } ?: false

            fun color(key: String) = a[key]?.takeIf { it != "default" }
            return InlineRun(
                text = span.text,
                bold = on("bold"),
                italic = on("italic"),
                underline = on("underline"),
                strike = on("strike"),
                code = on("code"),
                link = a["link"],
                textColor = color("textColor"),
                backgroundColor = color("backgroundColor"),
            )
        }
    }
}

/** What a block is, with what drawing it needs. (Swift `BlockKind`.) */
sealed class BlockKind {
    object Paragraph : BlockKind()

    /** Level 1 to 3. */
    data class Heading(
        val level: Int,
    ) : BlockKind()

    object Bullet : BlockKind()

    /** Its number in its list. */
    data class Numbered(
        val index: Int,
    ) : BlockKind()

    data class Check(
        val checked: Boolean,
    ) : BlockKind()

    object Quote : BlockKind()

    data class Code(
        val language: String?,
    ) : BlockKind()

    /** [blobId] is null when the url names no blob (the web shows it as broken). */
    data class Image(
        val blobId: String?,
        val caption: String,
        val name: String,
        val width: Double?,
    ) : BlockKind()

    object Divider : BlockKind()

    /** A kind this version does not draw; the web shows the same notice. */
    data class Unsupported(
        val kind: String,
    ) : BlockKind()
}

/** Text alignment, BlockNote's `textAlignment` prop. */
enum class BlockAlignment { LEFT, CENTER, RIGHT, JUSTIFY }

/** One block as the app draws it. (Swift `DocBlock`.) */
data class DocBlock(
    /** The contract's block id: what a comment and a block link name. */
    val id: String,
    val kind: BlockKind,
    val depth: Int = 0,
    val runs: List<InlineRun> = emptyList(),
    val alignment: BlockAlignment = BlockAlignment.LEFT,
    val textColor: String? = null,
    val backgroundColor: String? = null,
) {
    /** The block's words, without marks. */
    val plainText: String
        get() = (kind as? BlockKind.Image)?.let { it.caption.ifEmpty { it.name } } ?: runs.joinToString("") { it.text }

    /** Whether the block holds no words (an empty paragraph is a blank line). */
    val isBlank: Boolean get() = plainText.isBlank()
}

/** (Swift `DocumentReader`.) */
object DocumentReader {
    private val BLOB = Regex("^blob:([0-9a-f]{64})$")
    private const val MAX_HEADING = 3

    /** An image block's url names a blob, never an address (`lib/images.ts`). */
    fun blobId(url: String): String? = BLOB.find(url)?.groupValues?.get(1)

    /**
     * The rows as drawable blocks, numbering ordered lists the way BlockNote does: a run of
     * numbered items at one depth counts up, and anything else at that depth or shallower starts
     * the count again.
     */
    fun blocks(rows: List<WireBlock>): List<DocBlock> {
        val counters = mutableMapOf<Int, Int>()
        return rows.map { row ->
            val depth = maxOf(0, row.depth)
            counters.keys.filter { it > depth }.forEach { counters.remove(it) }
            val kind =
                if (row.kind == "numberedListItem") {
                    val start = row.attrs["start"]?.toIntOrNull() ?: 1
                    val next = counters[depth]?.plus(1) ?: start
                    counters[depth] = next
                    BlockKind.Numbered(next)
                } else {
                    counters.remove(depth)
                    kind(row)
                }

            fun color(key: String) = row.attrs[key]?.takeIf { it != "default" }
            DocBlock(
                id = row.id,
                kind = kind,
                depth = depth,
                runs = runs(row.spans),
                alignment = BlockAlignment.entries.firstOrNull { it.name.lowercase() == row.attrs["textAlignment"] } ?: BlockAlignment.LEFT,
                textColor = color("textColor"),
                backgroundColor = color("backgroundColor"),
            )
        }
    }

    private fun kind(row: WireBlock): BlockKind {
        val a = row.attrs
        return when (row.kind) {
            "paragraph" -> BlockKind.Paragraph
            "heading" -> BlockKind.Heading((a["level"]?.toIntOrNull() ?: 1).coerceIn(1, MAX_HEADING))
            "bulletListItem", "toggleListItem" -> BlockKind.Bullet
            "checkListItem" -> BlockKind.Check(a["checked"] == "true")
            "quote" -> BlockKind.Quote
            "codeBlock" -> BlockKind.Code(a["language"]?.takeIf { it.isNotEmpty() && it != "text" })
            "image" ->
                BlockKind.Image(
                    blobId = blobId(a["url"] ?: ""),
                    caption = a["caption"] ?: "",
                    name = a["name"] ?: "",
                    width = a["previewWidth"]?.toDoubleOrNull(),
                )
            "divider" -> BlockKind.Divider
            else -> BlockKind.Unsupported(row.kind)
        }
    }

    /** Spans as runs, neighbours with the same marks joined, empty ones dropped. */
    fun runs(spans: List<WireSpan>): List<InlineRun> {
        val out = mutableListOf<InlineRun>()
        for (span in spans) {
            if (span.text.isEmpty()) continue
            val run = InlineRun.of(span)
            val last = out.lastOrNull()
            if (last != null && last.sameMarks(run)) out[out.size - 1] = last.copy(text = last.text + run.text) else out += run
        }
        return out
    }

    /** The whole document's words, one block per line. */
    fun plainText(blocks: List<DocBlock>): String = blocks.map { it.plainText }.filter { it.isNotEmpty() }.joinToString("\n")

    /** Words in the document, as the web's status bar counts them. */
    fun wordCount(blocks: List<DocBlock>): Int = plainText(blocks).split(Regex("\\s+")).count { it.isNotEmpty() }
}

/** BlockNote's default colours, by name. (Swift `BlockNoteColors`.) */
object BlockNoteColors {
    val text: Map<String, Long> =
        mapOf(
            "gray" to 0x9B9A97,
            "brown" to 0x64473A,
            "red" to 0xE03E3E,
            "orange" to 0xD9730D,
            "yellow" to 0xDFAB01,
            "green" to 0x4D6461,
            "blue" to 0x0B6E99,
            "purple" to 0x6940A5,
            "pink" to 0xAD1A72,
        )
    val background: Map<String, Long> =
        mapOf(
            "gray" to 0xEBECED,
            "brown" to 0xE9E5E3,
            "red" to 0xFBE4E4,
            "orange" to 0xF6E9D9,
            "yellow" to 0xFBF3DB,
            "green" to 0xDDEDEA,
            "blue" to 0xDDEBF1,
            "purple" to 0xEAE4F2,
            "pink" to 0xF4DFEB,
        )
}
