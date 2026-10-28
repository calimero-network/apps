package network.calimero.calendar.data

import android.content.SharedPreferences

/** A small string store: SharedPreferences in the app, a map in tests. */
interface KeyValueStore {
    fun get(key: String): String?

    fun put(
        key: String,
        value: String?,
    )
}

class MemoryKeyValueStore : KeyValueStore {
    private val map = mutableMapOf<String, String>()

    override fun get(key: String): String? = synchronized(map) { map[key] }

    override fun put(
        key: String,
        value: String?,
    ) {
        synchronized(map) { if (value == null) map.remove(key) else map[key] = value }
    }
}

class PrefsKeyValueStore(
    private val prefs: SharedPreferences,
) : KeyValueStore {
    override fun get(key: String): String? = prefs.getString(key, null)

    override fun put(
        key: String,
        value: String?,
    ) {
        prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }
}

/**
 * Names this device knows that the relay may not (yet): teams and calendars it created or joined
 * through a link that named them, the person's name per calendar, and the last name used.
 * (The web app's `utils/teamName.ts` and `mc-username-<context>`.)
 */
class LocalNames(
    private val store: KeyValueStore,
) {
    fun team(id: String): String? = store.get("mc-team-name-$id")?.ifBlank { null }

    fun setTeam(
        id: String,
        name: String,
    ) = name.trim().takeIf { it.isNotEmpty() }?.let { store.put("mc-team-name-$id", it) }

    fun calendar(id: String): String? = store.get("mc-calendar-name-$id")?.ifBlank { null }

    fun setCalendar(
        id: String,
        name: String,
    ) = name.trim().takeIf { it.isNotEmpty() }?.let { store.put("mc-calendar-name-$id", it) }

    fun username(contextId: String): String? = store.get("mc-username-$contextId")?.ifBlank { null }

    fun setUsername(
        contextId: String,
        name: String,
    ) {
        store.put("mc-username-$contextId", name)
        store.put("mc-username-last", name)
    }

    fun lastUsername(): String? = store.get("mc-username-last")?.ifBlank { null }
}
