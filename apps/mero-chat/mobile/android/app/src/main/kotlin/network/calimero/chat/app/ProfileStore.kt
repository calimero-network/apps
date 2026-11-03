package network.calimero.chat.app

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The name this person goes by, registered with `set_profile` in each channel they create or join
 * (the web app's `getMessengerDisplayName`). Not a secret, so plain storage; the session itself
 * lives in the SDK's encrypted session store.
 */
class ProfileStore(
    private val store: KeyValueStore,
) {
    private val _displayName = MutableStateFlow(store.get(KEY).orEmpty())
    val displayName: StateFlow<String> = _displayName.asStateFlow()

    fun setDisplayName(name: String) {
        val clean = name.trim()
        if (clean.isEmpty()) store.remove(KEY) else store.put(KEY, clean)
        _displayName.value = clean
    }

    fun clear() = setDisplayName("")

    private companion object {
        const val KEY = "mero-chat.display-name"
    }
}

/** Plain string preferences. */
interface KeyValueStore {
    fun get(key: String): String?

    fun put(
        key: String,
        value: String,
    )

    fun remove(key: String)
}

/** [KeyValueStore] over the app's private SharedPreferences file [name]. */
class SharedPreferencesStore(
    context: Context,
    name: String,
) : KeyValueStore {
    private val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)

    override fun get(key: String): String? = prefs.getString(key, null)

    override fun put(
        key: String,
        value: String,
    ) = prefs.edit().putString(key, value).apply()

    override fun remove(key: String) = prefs.edit().remove(key).apply()
}

/** [KeyValueStore] in memory, for tests. */
class MemoryKeyValueStore : KeyValueStore {
    private val values = mutableMapOf<String, String>()

    override fun get(key: String): String? = values[key]

    override fun put(
        key: String,
        value: String,
    ) {
        values[key] = value
    }

    override fun remove(key: String) {
        values.remove(key)
    }
}
