package network.calimero.chat.app

import com.calimero.mero.compose.MemoryKeyValueStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.jsonPrimitive
import network.calimero.chat.data.Channel
import network.calimero.chat.data.ChatProfile
import network.calimero.chat.data.ChatRepository
import network.calimero.chat.data.Workspace
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Opening a channel the account can already write in. Found by the live tests: an invitee is a
 * member of every open channel without joining one, so the join path that registers their name
 * never ran and others saw them by short id.
 */
class ChannelsModelTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val chat = InMemoryChat()
    private val profile = ProfileStore(MemoryKeyValueStore()).also { it.setDisplayName("Bob") }
    private val model = ChannelsModel(ChatRepository(chat), scope, profile, Workspace("ws", "Team"))
    private val general = Channel("ctx", "grp", "ws", "general", joined = true)

    @After
    fun tearDown() = scope.cancel()

    @Test
    fun `opening a joined channel with no name of yours registers it`() =
        runBlocking {
            chat.profiles = listOf(ChatProfile(InMemoryChat.OTHER, "alice"))
            var ready: Channel? = null
            model.open(general) { ready = it }.join()

            assertEquals(general, ready)
            assertEquals(listOf("get_profiles", "set_profile"), chat.methods())
            assertEquals(
                "Bob",
                chat.calls
                    .last()
                    .second["username"]!!
                    .jsonPrimitive.content,
            )
        }

    @Test
    fun `opening a joined channel where you have a name writes nothing`() =
        runBlocking {
            model.open(general) {}.join()
            assertEquals(listOf("get_profiles"), chat.methods())
        }

    @Test
    fun `a failed name lookup still opens the channel`() =
        runBlocking {
            chat.failNext = IllegalStateException("relay down")
            var ready: Channel? = null
            model.open(general) { ready = it }.join()
            assertEquals(general, ready)
            assertTrue(chat.methods().none { it == "set_profile" })
        }
}
