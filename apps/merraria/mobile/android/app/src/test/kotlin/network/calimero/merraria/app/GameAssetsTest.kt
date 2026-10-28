package network.calimero.merraria.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The bundle both apps ship (`mobile/game/www`, packaged as the `www/` asset folder) is there, complete, and local. */
class GameAssetsTest {
    // Unit tests run in the module directory (android/app).
    private val root = File("../../game/www")

    @Test
    fun `the bundled game is complete and local`() {
        val index = File(root, "index.html")
        assertTrue("run scripts/build-game.sh: ${index.absolutePath}", index.isFile)
        val html = index.readText()
        val files = Regex("""(?:src|href)="\./([^"]+)"""").findAll(html).map { it.groupValues[1] }.toList()
        assertTrue(files.toString(), files.any { it.startsWith("assets/") && it.endsWith(".js") })
        assertTrue(files.toString(), files.any { it.endsWith(".css") })
        files.forEach { assertTrue("missing $it", File(root, it).isFile) }
        assertFalse(html.contains("src=\"http"))
        val code = files.filter { it.endsWith(".js") }.joinToString("") { File(root, it).readText() }
        assertTrue(code.contains("MeroBridgeAndroid"))
        assertTrue(code.contains("meroBridge"))
    }
}
