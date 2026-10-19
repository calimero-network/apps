package network.calimero.chat.ui

/** Navigation routes. Ids only: names are looked up in the view models, so nothing needs escaping. */
internal object Routes {
    const val WORKSPACES = "workspaces"
    const val WORKSPACE = "workspace/{ws}"
    const val CHANNEL = "channel/{ws}/{ctx}"

    fun workspace(id: String) = "workspace/$id"

    fun channel(
        workspaceId: String,
        contextId: String,
    ) = "channel/$workspaceId/$contextId"
}
