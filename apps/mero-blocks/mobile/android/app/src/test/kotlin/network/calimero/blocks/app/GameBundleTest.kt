package network.calimero.blocks.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The game page the app bundles (app/build.gradle.kts adds `../../game/assets` as an assets folder,
 * so the APK carries `assets/game/`). Checked here so a missing or stale build fails the unit
 * tests, not the phone. (Swift `GameBundleTests`.)
 */
class GameBundleTest {
    // Unit tests run in the app module's directory.
    private val folder = File("../../game/assets/game")

    @Test
    fun thePageAndItsScriptAreThere() {
        val html = File(folder, "index.html").readText()
        assertTrue("one classic script, loaded locally", html.contains("""<script src="./game.js"></script>"""))
        assertFalse("a module script", html.contains("type=\"module\""))
        assertFalse("nothing is fetched at run time", html.contains("http://") || html.contains("https://"))

        val script = File(folder, "game.js").readText()
        assertTrue("three.js and the engine are inlined", script.length > 100_000)
        for (needle in listOf("meroBridge", "messageHandlers", "meroBlocks", "MeroBlocksAndroid", "set_blocks", "get_players")) {
            assertTrue("game.js has no $needle", script.contains(needle))
        }
        assertFalse("no dynamic imports: everything is in one file", script.contains("import("))
    }
}
