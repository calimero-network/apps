package network.calimero.blocks.app

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Where the settings live: SharedPreferences in the app, a map in tests. */
interface SettingsStore {
    fun string(key: String): String?

    fun double(key: String): Double?

    fun put(
        key: String,
        value: String,
    )

    fun put(
        key: String,
        value: Double,
    )
}

/**
 * The player's name in worlds and their look sensitivity, kept on the device (the web app keeps the
 * name in `localStorage` the same way). (Swift `PlayerSettings`.)
 */
class PlayerSettings(
    private val store: SettingsStore,
) {
    private val _name = MutableStateFlow(store.string(NAME_KEY) ?: BlocksConstants.DEFAULT_PLAYER_NAME)
    val name: StateFlow<String> = _name.asStateFlow()

    private val _sensitivity =
        MutableStateFlow(store.double(SENSITIVITY_KEY)?.let(BlocksText::sensitivity) ?: BlocksConstants.DEFAULT_SENSITIVITY)
    val sensitivity: StateFlow<Double> = _sensitivity.asStateFlow()

    /** The name as it goes to the contract: trimmed, never empty, at most 16 characters. */
    val playerName: String get() = BlocksText.playerName(_name.value)

    fun setName(value: String) {
        _name.value = value
        store.put(NAME_KEY, value)
    }

    fun setSensitivity(value: Double) {
        val clamped = BlocksText.sensitivity(value)
        _sensitivity.value = clamped
        store.put(SENSITIVITY_KEY, clamped)
    }

    companion object {
        const val NAME_KEY = "blocks.playerName"
        const val SENSITIVITY_KEY = "blocks.sensitivity"
    }
}
