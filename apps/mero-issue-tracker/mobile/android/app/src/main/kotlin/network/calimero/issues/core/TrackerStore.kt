package network.calimero.issues.core

import android.content.Context
import android.content.SharedPreferences

/**
 * What the app remembers on this device: the open workspace and repo, and the names of repos (a
 * repo's name is a context label the relay does not return, see README "SDK gaps").
 */
interface TrackerStore {
    fun repoName(contextId: String): String?

    fun setRepoName(
        contextId: String,
        name: String,
    )

    var activeWorkspace: String?

    fun activeRepo(workspaceId: String): String?

    fun setActiveRepo(
        workspaceId: String,
        contextId: String?,
    )
}

/** [TrackerStore] in SharedPreferences. */
class PrefsTrackerStore(
    context: Context,
) : TrackerStore {
    private val prefs: SharedPreferences = context.getSharedPreferences("issues", Context.MODE_PRIVATE)

    override fun repoName(contextId: String): String? = prefs.getString("repoName.$contextId", null)

    override fun setRepoName(
        contextId: String,
        name: String,
    ) = prefs.edit().putString("repoName.$contextId", name).apply()

    override var activeWorkspace: String?
        get() = prefs.getString("workspace", null)
        set(value) = prefs.edit().putString("workspace", value).apply()

    override fun activeRepo(workspaceId: String): String? = prefs.getString("repo.$workspaceId", null)

    override fun setActiveRepo(
        workspaceId: String,
        contextId: String?,
    ) = prefs.edit().putString("repo.$workspaceId", contextId).apply()
}

/** [TrackerStore] in memory, for tests and previews. */
class MemoryTrackerStore : TrackerStore {
    private val names = mutableMapOf<String, String>()
    private val repos = mutableMapOf<String, String?>()

    @Volatile override var activeWorkspace: String? = null

    @Synchronized override fun repoName(contextId: String): String? = names[contextId]

    @Synchronized override fun setRepoName(
        contextId: String,
        name: String,
    ) {
        names[contextId] = name
    }

    @Synchronized override fun activeRepo(workspaceId: String): String? = repos[workspaceId]

    @Synchronized override fun setActiveRepo(
        workspaceId: String,
        contextId: String?,
    ) {
        repos[workspaceId] = contextId
    }
}
