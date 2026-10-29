package network.calimero.chess.app

import androidx.core.graphics.PathParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The exported piece set (scripts/export-pieces.mjs) parses as Android path data, all twelve of it. */
class PiecesTest {
    private val drawables = File("src/main/res/drawable")

    @Test
    fun `every piece is present and every path parses`() {
        val names = PieceColor.entries.flatMap { color -> "kqrbnp".map { Piece(color, it).assetName } }
        assertEquals(12, names.toSet().size)
        for (name in names) {
            val file = File(drawables, "piece_${name.lowercase()}.xml")
            assertTrue("missing ${file.name}", file.isFile)
            val paths = Regex("android:pathData=\"([^\"]+)\"").findAll(file.readText()).map { it.groupValues[1] }.toList()
            assertTrue("${file.name} has no paths", paths.isNotEmpty())
            for (data in paths) {
                val nodes = PathParser.createNodesFromPathData(data)
                assertTrue("${file.name}: unparsed path", nodes.isNotEmpty())
            }
        }
    }
}
