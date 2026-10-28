package network.calimero.sheets.core

import android.content.Context
import android.content.SharedPreferences

/**
 * What the app remembers on this device: the open workspace, and the names of spreadsheets this
 * device created (shown until the workbook's own name, from `get_project`, can be read).
 */
interface SheetsStore {
    fun spreadsheetName(contextId: String): String?

    fun setSpreadsheetName(
        contextId: String,
        name: String,
    )

    var activeWorkspace: String?
}

/** [SheetsStore] in SharedPreferences. */
class PrefsSheetsStore(
    context: Context,
) : SheetsStore {
    private val prefs: SharedPreferences = context.getSharedPreferences("sheets", Context.MODE_PRIVATE)

    override fun spreadsheetName(contextId: String): String? = prefs.getString("name.$contextId", null)

    override fun setSpreadsheetName(
        contextId: String,
        name: String,
    ) = prefs.edit().putString("name.$contextId", name).apply()

    override var activeWorkspace: String?
        get() = prefs.getString("workspace", null)
        set(value) = prefs.edit().putString("workspace", value).apply()
}

/** [SheetsStore] in memory, for tests and previews. */
class MemorySheetsStore : SheetsStore {
    private val names = mutableMapOf<String, String>()

    @Volatile override var activeWorkspace: String? = null

    @Synchronized override fun spreadsheetName(contextId: String): String? = names[contextId]

    @Synchronized override fun setSpreadsheetName(
        contextId: String,
        name: String,
    ) {
        names[contextId] = name
    }
}
