package network.calimero.chat.app

import com.calimero.mero.compose.KeyValueStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The name this person goes by, registered with `set_profile` in each channel they create or join
 * (the web app's `getMessengerDisplayName`). Not a secret, so plain storage; the session itself
 * lives in the SDK's encrypted stores.
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
